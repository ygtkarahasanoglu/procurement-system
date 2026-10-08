import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/client";
import * as rfqDispatchService from "../src/services/rfqDispatchService";
import * as quoteDocumentService from "../src/services/quoteDocumentService";
import { NotFoundError, ValidationError } from "../src/domain/errors";
import { FakeQuoteExtractionProvider } from "./support/fakeQuoteExtractionProvider";

// AI-1 (docs/decisions/ratified.md) — Commit 4: supplier document upload
// via the RFQ response link, "partly supersedes RFQ-R5". Mirrors
// supplierResponse.test.ts's own fixtures/conventions (real Postgres,
// no mocking) — the only difference under test here is what this one
// upload path creates (QuoteDocument, never a QuoteVersion) and that it
// still consumes the token exactly like a form submission.
describe("quoteDocumentService.uploadSupplierQuoteDocument (AI-1, Commit 4)", () => {
  let tenantId: string;
  let supplierId: string;
  let sourcingEventId: string;

  const PDF_CONTENT = Buffer.from("%PDF-1.4 supplier link upload test");
  const PDF_BASE64 = PDF_CONTENT.toString("base64");

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "SupplierDocUpload Tenant" } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, name: "SupplierDocUpload User", role: "procurement_user" } });
    const product = await prisma.product.create({ data: { tenantId, name: "SupplierDocUpload Product", sku: "SDU-1" } });
    supplierId = (await prisma.supplier.create({ data: { tenantId, name: "SupplierDocUpload Supplier", email: "s@example.com" } })).id;
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "10", unit: "EA" },
    });
    sourcingEventId = (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  });

  async function freshTokenDispatch() {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const { rawToken } = await rfqDispatchService.issueResponseToken(tenantId, dispatch.id);
    return { dispatch, rawToken };
  }

  function freshProvider() {
    const provider = new FakeQuoteExtractionProvider();
    provider.setNextResult({
      provider: "fake",
      model: "fake-1",
      result: { lines: [{ description: "SupplierDocUpload Product", quantity: "10", unit: "EA", unitPrice: "3.00", currency: "EUR" }] },
    });
    return provider;
  }

  it("1. a valid token consumes it, stores a SUPPLIER_LINK QuoteDocument, runs extraction, and records SUPPLIER_RESPONSE_RECEIVED — but never creates a QuoteVersion", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    const provider = freshProvider();

    const { document, extraction } = await quoteDocumentService.uploadSupplierQuoteDocument(
      rawToken,
      { fileName: "supplier-quote.pdf", mimeType: "application/pdf", base64: PDF_BASE64 },
      { provider }
    );

    expect(document.uploadedVia).toBe("SUPPLIER_LINK");
    expect(document.sourcingEventId).toBe(sourcingEventId);
    expect(document.supplierId).toBe(supplierId);
    expect((document as Record<string, unknown>).content).toBeUndefined();
    expect(extraction.status).toBe("PENDING_REVIEW");

    const updatedDispatch = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(updatedDispatch.respondedAt).not.toBeNull();
    // RFQ-R3: status is deliberately NOT transitioned by response capture
    // (this fixture never calls sendRFQDispatch, so it is still PENDING).
    expect(updatedDispatch.status).toBe("PENDING");

    const events = await prisma.rFQCommunicationEvent.findMany({ where: { rfqDispatchId: dispatch.id } });
    const responseEvent = events.find((e) => e.eventType === "SUPPLIER_RESPONSE_RECEIVED");
    expect(responseEvent).toBeDefined();
    expect(responseEvent?.actorSource).toBe("SUPPLIER");
    expect(responseEvent?.quoteVersionId).toBeNull();

    const versionCount = await prisma.quoteVersion.count({ where: { tenantId, supplierQuote: { rfqDispatchId: dispatch.id } } });
    expect(versionCount).toBe(0);
  });

  it("2. the token is consumed exactly like a form submission — a later form submission with the same token is rejected", async () => {
    const { rawToken } = await freshTokenDispatch();
    await quoteDocumentService.uploadSupplierQuoteDocument(
      rawToken,
      { fileName: "supplier-quote.pdf", mimeType: "application/pdf", base64: PDF_BASE64 },
      { provider: freshProvider() }
    );

    await expect(
      rfqDispatchService.submitSupplierResponse(rawToken, { quantity: "1", unit: "EA", unitPrice: "1", currency: "EUR" })
    ).rejects.toThrow(NotFoundError);
  });

  it("3. an invalid (never-issued) token is rejected, with no QuoteDocument created", async () => {
    const before = await prisma.quoteDocument.count();
    await expect(
      quoteDocumentService.uploadSupplierQuoteDocument(
        randomUUID(),
        { fileName: "x.pdf", mimeType: "application/pdf", base64: PDF_BASE64 },
        { provider: freshProvider() }
      )
    ).rejects.toThrow(NotFoundError);
    expect(await prisma.quoteDocument.count()).toBe(before);
  });

  it("4. an expired token is rejected and never consumed", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });

    await expect(
      quoteDocumentService.uploadSupplierQuoteDocument(
        rawToken,
        { fileName: "x.pdf", mimeType: "application/pdf", base64: PDF_BASE64 },
        { provider: freshProvider() }
      )
    ).rejects.toThrow(NotFoundError);

    const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(unchanged.respondedAt).toBeNull();
  });

  it("5. rejects an unsupported mime type and an oversized file, before consuming the token", async () => {
    const { dispatch: d1, rawToken: t1 } = await freshTokenDispatch();
    await expect(
      quoteDocumentService.uploadSupplierQuoteDocument(t1, { fileName: "x.txt", mimeType: "text/plain", base64: PDF_BASE64 }, { provider: freshProvider() })
    ).rejects.toThrow(ValidationError);
    expect((await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: d1.id } })).respondedAt).toBeNull();

    const { dispatch: d2, rawToken: t2 } = await freshTokenDispatch();
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    await expect(
      quoteDocumentService.uploadSupplierQuoteDocument(t2, { fileName: "x.pdf", mimeType: "application/pdf", base64: tooBig }, { provider: freshProvider() })
    ).rejects.toThrow(ValidationError);
    expect((await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: d2.id } })).respondedAt).toBeNull();
  });

  it("6. end-to-end: a buyer can confirm the supplier-uploaded document into a QuoteVersion", async () => {
    const { rawToken } = await freshTokenDispatch();
    const { extraction } = await quoteDocumentService.uploadSupplierQuoteDocument(
      rawToken,
      { fileName: "supplier-quote.pdf", mimeType: "application/pdf", base64: PDF_BASE64 },
      { provider: freshProvider() }
    );

    const user = await prisma.user.findFirstOrThrow({ where: { tenantId, role: "procurement_user" } });
    const product = await prisma.product.findFirstOrThrow({ where: { tenantId } });
    const quote = await quoteDocumentService.confirmExtraction(tenantId, user.id, extraction.id, {
      productId: product.id,
      quotedQuantity: "10",
      unit: "EA",
      unitPrice: "3.00",
      currency: "EUR",
    });
    expect(quote.versions[0].currency).toBe("EUR");

    const updatedExtraction = await prisma.quoteExtraction.findUniqueOrThrow({ where: { id: extraction.id } });
    expect(updatedExtraction.status).toBe("CONFIRMED");
    expect(updatedExtraction.quoteVersionId).toBe(quote.versions[0].id);
  });
});
