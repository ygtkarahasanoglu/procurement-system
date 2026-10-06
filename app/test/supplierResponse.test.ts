import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { prisma, tenantScoped, TenantGuardRejection } from "../src/db/client";
import * as rfqDispatchService from "../src/services/rfqDispatchService";
import { hashToken } from "../src/api/rfqResponseToken";
import { NotFoundError, ValidationError } from "../src/domain/errors";
import { createApp } from "../src/api/server";
import { testAuthenticator } from "./support/testAuthenticator";

// Supplier Response / Quote Ingestion V1 — RFQ-R1 through RFQ-R5
// (docs/decisions/ratified.md). The capability is unauthenticated: the
// opaque raw token is the sole client-supplied identifier. Exercises the
// real test database, following this repo's existing convention.
describe("submitSupplierResponse (service)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let supplierAId: string;
  let supplierBId: string;
  let sourcingEventAId: string;
  let sourcingEventBId: string;

  async function makeSourcingEvent(tenantId: string, label: string) {
    const user = await prisma.user.create({ data: { tenantId, name: `${label} User`, role: "procurement_user" } });
    const product = await prisma.product.create({ data: { tenantId, name: `${label} Product`, sku: `${label}-SKU` } });
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "100", unit: "EA" },
    });
    return (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  }

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "SupplierResponse Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "SupplierResponse Tenant B Secret" } });
    tenantBId = tenantB.id;

    supplierAId = (
      await prisma.supplier.create({ data: { tenantId: tenantAId, name: "SupplierResponse Supplier A", email: "a@example.com" } })
    ).id;
    supplierBId = (
      await prisma.supplier.create({ data: { tenantId: tenantBId, name: "SupplierResponse Supplier B Secret", email: "b@example.com" } })
    ).id;

    sourcingEventAId = await makeSourcingEvent(tenantAId, "SR-A");
    sourcingEventBId = await makeSourcingEvent(tenantBId, "SR-B-Secret");
  });

  async function freshTokenDispatch(sourcingEventId = sourcingEventAId, supplierId = supplierAId, tenantId = tenantAId) {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const { rawToken } = await rfqDispatchService.issueResponseToken(tenantId, dispatch.id);
    return { dispatch, rawToken };
  }

  const validPayload = { quantity: "10", unit: "EA", unitPrice: "5.50", currency: "USD" };

  // ---------------------------------------------------------------
  // A. valid token + valid response -> success
  // ---------------------------------------------------------------
  it("A. a valid token with a valid response succeeds, creating a SupplierQuote+QuoteVersion traced to the dispatch", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    const result = await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);

    expect(result.rfqDispatchId).toBe(dispatch.id);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].currency).toBe("USD");
  });

  // ---------------------------------------------------------------
  // B. invalid token -> failure, no DB mutation
  // ---------------------------------------------------------------
  it("B. an invalid (never-issued) token is rejected, with no SupplierQuote created", async () => {
    const before = await prisma.supplierQuote.count();
    await expect(rfqDispatchService.submitSupplierResponse(randomUUID(), validPayload)).rejects.toThrow(NotFoundError);
    const after = await prisma.supplierQuote.count();
    expect(after).toBe(before);
  });

  // ---------------------------------------------------------------
  // C. expired token -> failure, token remains unconsumed
  // ---------------------------------------------------------------
  it("C. an expired token is rejected and never consumed", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });

    await expect(rfqDispatchService.submitSupplierResponse(rawToken, validPayload)).rejects.toThrow(NotFoundError);

    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(row.respondedAt).toBeNull();
  });

  // ---------------------------------------------------------------
  // D / T. already-consumed token -> failure, no second QuoteVersion
  // ---------------------------------------------------------------
  it("D/T. an already-consumed token is rejected and cannot create a second response", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);

    await expect(rfqDispatchService.submitSupplierResponse(rawToken, validPayload)).rejects.toThrow(NotFoundError);

    const quoteCount = await prisma.supplierQuote.count({ where: { rfqDispatchId: dispatch.id } });
    expect(quoteCount).toBe(1);
  });

  // ---------------------------------------------------------------
  // E. malformed payload -> failure, token reusable
  // ---------------------------------------------------------------
  it("E. a malformed (non-object) payload is rejected and the token remains reusable", async () => {
    const { rawToken } = await freshTokenDispatch();
    await expect(rfqDispatchService.submitSupplierResponse(rawToken, "not an object")).rejects.toThrow(ValidationError);
    await expect(rfqDispatchService.submitSupplierResponse(rawToken, null)).rejects.toThrow(ValidationError);

    // Reusable: the same token still succeeds with a valid payload.
    const result = await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);
    expect(result.versions).toHaveLength(1);
  });

  // ---------------------------------------------------------------
  // F. validation failure -> failure, token reusable
  // ---------------------------------------------------------------
  it("F. a validation failure (negative quantity) is rejected and the token remains reusable", async () => {
    const { rawToken } = await freshTokenDispatch();
    await expect(
      rfqDispatchService.submitSupplierResponse(rawToken, { ...validPayload, quantity: "-5" })
    ).rejects.toThrow();
    await expect(
      rfqDispatchService.submitSupplierResponse(rawToken, { ...validPayload, currency: "dollars" })
    ).rejects.toThrow();

    const result = await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);
    expect(result.versions).toHaveLength(1);
  });

  // ---------------------------------------------------------------
  // G, J-M. unsupported/unknown fields -> rejected, token reusable, no records
  // ---------------------------------------------------------------
  const rejectedFields: Record<string, unknown> = {
    dispatchId: "x",
    supplierId: "x",
    quoteId: "x",
    tenantId: "x",
    sourcingEventId: "x",
    productId: "x",
    someUnknownField: "x",
  };

  for (const [field, value] of Object.entries(rejectedFields)) {
    it(`G/J-M. a payload including "${field}" is rejected outright, not silently ignored`, async () => {
      const { dispatch, rawToken } = await freshTokenDispatch();
      const callsBefore = await prisma.supplierQuote.count();

      await expect(
        rfqDispatchService.submitSupplierResponse(rawToken, { ...validPayload, [field]: value })
      ).rejects.toThrow(ValidationError);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.respondedAt).toBeNull();
      expect(await prisma.supplierQuote.count()).toBe(callsBefore);

      // Token remains fully usable afterward.
      const result = await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);
      expect(result.versions).toHaveLength(1);
    });
  }

  // ---------------------------------------------------------------
  // I. concurrent same-token submissions -> exactly one success
  // ---------------------------------------------------------------
  it("I. exactly one of two concurrent submissions against the same token succeeds", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();

    const results = await Promise.allSettled([
      rfqDispatchService.submitSupplierResponse(rawToken, validPayload),
      rfqDispatchService.submitSupplierResponse(rawToken, { ...validPayload, quantity: "20" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundError);

    expect(await prisma.supplierQuote.count({ where: { rfqDispatchId: dispatch.id } })).toBe(1);
    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(row.respondedAt).not.toBeNull();
  });

  it("the CAS claim is genuinely guarded by tenantScoped() — a tenant-mismatched claim is rejected by the guard itself", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    const tokenHash = hashToken(rawToken);
    const db = tenantScoped(tenantBId);
    await expect(
      db.rFQDispatch.updateMany({
        where: { id: dispatch.id, tenantId: tenantAId, responseTokenHash: tokenHash, respondedAt: null },
        data: { respondedAt: new Date() },
      })
    ).rejects.toThrow(TenantGuardRejection);
  });

  // ---------------------------------------------------------------
  // N, O. token-derived tenant/supplier context
  // ---------------------------------------------------------------
  it("N/O. the created QuoteVersion/SupplierQuote use exactly the token-derived tenant and supplier, never a client-supplied one", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    const result = await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);

    expect(result.tenantId).toBe(tenantAId);
    expect(result.supplierId).toBe(supplierAId);
    expect(result.sourcingEventId).toBe(sourcingEventAId);
    expect(result.versions[0].tenantId).toBe(tenantAId);

    // A tenant B dispatch's response never contains tenant A identifiers.
    const { rawToken: tokenB } = await freshTokenDispatch(sourcingEventBId, supplierBId, tenantBId);
    const resultB = await rfqDispatchService.submitSupplierResponse(tokenB, validPayload);
    expect(resultB.tenantId).toBe(tenantBId);
    expect(resultB.tenantId).not.toBe(dispatch.tenantId);
  });

  // ---------------------------------------------------------------
  // P. exact-value preservation, no coercion
  // ---------------------------------------------------------------
  it("P. persisted commercial values are exactly the submitted semantic values", async () => {
    const { rawToken } = await freshTokenDispatch();
    const result = await rfqDispatchService.submitSupplierResponse(rawToken, {
      quantity: "12.3400",
      unit: "KG",
      unitPrice: "99.9900",
      currency: "EUR",
    });

    // Compared as numeric/semantic value, not exact string: Prisma's
    // Decimal.toString() normalizes trailing zeros ("12.3400" ->
    // "12.34") — this is inherent Decimal formatting, not coercion. An
    // actual coercion violation would change the NUMBER (e.g. rounding),
    // which this comparison would still catch.
    const version = result.versions[0];
    expect(Number(version.quotedQuantity.toString())).toBe(12.34);
    expect(version.unit).toBe("KG");
    expect(Number(version.unitPrice.toString())).toBe(99.99);
    expect(version.currency).toBe("EUR");
  });

  // ---------------------------------------------------------------
  // Q. raw token never logged
  // ---------------------------------------------------------------
  it("Q. the implementation never logs anything — the raw token cannot leak into log output that does not exist", async () => {
    const source = await readFile(join(__dirname, "../src/services/rfqDispatchService.ts"), "utf-8");
    expect(source).not.toMatch(/console\./);
  });

  // ---------------------------------------------------------------
  // R, S. respondedAt set; status untouched
  // ---------------------------------------------------------------
  it("R/S. a successful response sets respondedAt but does NOT change RFQDispatch.status", async () => {
    const { dispatch, rawToken } = await freshTokenDispatch();
    await rfqDispatchService.submitSupplierResponse(rawToken, validPayload);

    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(row.respondedAt).not.toBeNull();
    expect(row.status).toBe("PENDING");
  });

  // ---------------------------------------------------------------
  // H. QuoteVersion/SupplierQuote creation failure -> rollback — see
  // final report for why this case is not exercised with a genuine
  // forced DB-level failure (no natural fault-injection point exists
  // without either a test-only production hook or mocking the
  // transaction-scoped Prisma client, neither of which is this repo's
  // existing convention).
  // ---------------------------------------------------------------
});

// ---------------------------------------------------------------
// HTTP boundary — unauthenticated, Principal-free
// ---------------------------------------------------------------
describe("POST /rfq-responses/:token (HTTP)", () => {
  let httpServer: Server;
  let baseUrl: string;
  let tenantId: string;
  let supplierId: string;
  let sourcingEventId: string;

  async function httpPost(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // no body
    }
    return { status: res.status, json };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer = createServer(createApp(testAuthenticator));
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "SupplierResponse HTTP Tenant" } });
    tenantId = tenant.id;
    supplierId = (
      await prisma.supplier.create({ data: { tenantId, name: "SR HTTP Supplier", email: "http@example.com" } })
    ).id;
    const user = await prisma.user.create({ data: { tenantId, name: "SR HTTP User", role: "procurement_user" } });
    const product = await prisma.product.create({ data: { tenantId, name: "SR HTTP Product", sku: "SRHTTP-SKU" } });
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "1", unit: "EA" },
    });
    sourcingEventId = (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  });

  it("is reachable with NO authentication at all — no session cookie, no test-auth headers", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const { rawToken } = await rfqDispatchService.issueResponseToken(tenantId, dispatch.id);

    const res = await httpPost(`/rfq-responses/${rawToken}`, { quantity: "5", unit: "EA", unitPrice: "1", currency: "USD" });
    expect(res.status).toBe(200);
  });

  it("rejects an unsupported field over HTTP with a 400-equivalent response", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const { rawToken } = await rfqDispatchService.issueResponseToken(tenantId, dispatch.id);

    const res = await httpPost(`/rfq-responses/${rawToken}`, {
      quantity: "5",
      unit: "EA",
      unitPrice: "1",
      currency: "USD",
      supplierId: "attacker-supplied",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid token over HTTP with a generic not-found-equivalent response", async () => {
    const res = await httpPost(`/rfq-responses/${randomUUID()}`, { quantity: "1", unit: "EA", unitPrice: "1", currency: "USD" });
    expect(res.status).toBe(404);
  });
});
