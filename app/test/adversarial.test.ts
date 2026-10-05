import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/client";
import * as requestService from "../src/services/requestService";
import * as sourcingService from "../src/services/sourcingService";
import * as quoteService from "../src/services/quoteService";
import * as recommendationService from "../src/services/recommendationService";
import * as decisionService from "../src/services/decisionService";
import * as approvalService from "../src/services/approvalService";
import * as purchaseOrderService from "../src/services/purchaseOrderService";
import { createApp } from "../src/api/server";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";
import {
  ValidationError,
  NotFoundError,
  InvalidStateError,
  ApprovalRequiredError,
  CommercialDeviationError,
} from "../src/domain/errors";
import { AuthorizationError } from "../src/domain/authorization";

// Adversarial / negative-path hardening tests. These are ADDITIONAL to
// test/workflow.e2e.test.ts (the original 9 happy-path tests), which
// are left completely untouched and must still pass. This file reuses
// its own tenant/fixture set so the two files cannot interfere with
// each other under vitest's single-worker (fileParallelism: false)
// execution.
//
// HTTP-level cases use Node's built-in `fetch` against an in-process
// `http.Server` wrapping the Express `app` export (server.ts itself is
// never started as a separate process), so body-parser/JSON-handling
// behavior is exercised for real, not just the service functions.

import { createServer, type Server } from "node:http";

let httpServer: Server;
let baseUrl: string;

// Set once in beforeAll, once the suite's own fixture tenant/user exist —
// the default identity every httpPost/httpGet call authenticates as unless
// a caller explicitly overrides `headers` (an explicit `null` sends no
// auth headers at all, for unauthenticated-request tests; an explicit
// object sends exactly those headers, for other-principal tests).
let defaultTestAuthHeaders: Record<string, string> | null = null;

function resolveAuthHeaders(headers: Record<string, string> | null | undefined): Record<string, string> {
  if (headers === null) return {};
  return headers ?? defaultTestAuthHeaders ?? {};
}

async function httpPost(
  path: string,
  body: unknown,
  rawBody?: string,
  headers?: Record<string, string> | null
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...resolveAuthHeaders(headers) },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // no body / not JSON
  }
  return { status: res.status, json };
}

async function httpGet(path: string, headers?: Record<string, string> | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: resolveAuthHeaders(headers),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // no body / not JSON
  }
  return { status: res.status, json };
}

async function httpPatch(path: string, body: unknown, headers?: Record<string, string> | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...resolveAuthHeaders(headers) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // no body / not JSON
  }
  return { status: res.status, json };
}

describe("Adversarial / hardening tests", () => {
  let tenantId: string;
  let otherTenantId: string;
  let procurementUserId: string;
  let approverUserId: string;
  let otherTenantUserId: string;
  let productAId: string;
  let productBId: string;
  let supplierAId: string;
  let supplierBId: string;
  let requestLineId: string;

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

    const tenant = await prisma.tenant.create({ data: { name: "Adversarial Test Tenant" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "Adversarial Other Tenant" } });
    otherTenantId = otherTenant.id;

    procurementUserId = (
      await prisma.user.create({ data: { tenantId, name: "Adversarial PUser", role: "procurement_user" } })
    ).id;
    approverUserId = (await prisma.user.create({ data: { tenantId, name: "Adversarial Approver", role: "approver" } })).id;
    otherTenantUserId = (
      await prisma.user.create({ data: { tenantId: otherTenantId, name: "Other Tenant User", role: "approver" } })
    ).id;

    productAId = (await prisma.product.create({ data: { tenantId, name: "Adversarial Product A", sku: "ADV-A" } })).id;
    productBId = (await prisma.product.create({ data: { tenantId, name: "Adversarial Product B", sku: "ADV-B" } })).id;
    supplierAId = (await prisma.supplier.create({ data: { tenantId, name: "Adversarial Supplier A" } })).id;
    supplierBId = (await prisma.supplier.create({ data: { tenantId, name: "Adversarial Supplier B" } })).id;

    defaultTestAuthHeaders = {
      [TEST_USER_ID_HEADER]: procurementUserId,
      [TEST_TENANT_ID_HEADER]: tenantId,
    };

    const request = await requestService.createRequest({
      tenantId,
      createdById: procurementUserId,
      lines: [{ productId: productAId, requestedQuantity: 100, unit: "EA" }],
    });
    requestLineId = request.lines[0].id;
  });

  // RL-C3 (one ACTIVE SourcingEvent per RequestLine) is correctly
  // enforced by the service layer, which means the shared `requestLineId`
  // fixture above can carry only one OPEN SourcingEvent for the whole
  // suite's lifetime. Every test below that needs its own SourcingEvent
  // therefore creates a fresh RequestLine first, rather than reusing
  // `requestLineId` — reusing it across many independent tests would
  // itself trip RL-C3 and is not what those tests are trying to exercise
  // (the one test that *does* intentionally exercise RL-C3's concurrency
  // behavior creates its own dedicated line explicitly, see Group 10).
  async function freshLineId(): Promise<string> {
    const req = await requestService.createRequest({
      tenantId,
      createdById: procurementUserId,
      lines: [{ productId: productAId, requestedQuantity: 100, unit: "EA" }],
    });
    return req.lines[0].id;
  }

  // ---------------------------------------------------------------
  // Group 1 — Input validation
  // ---------------------------------------------------------------
  describe("Group 1 — input validation", () => {
    it("rejects empty body on POST /requests cleanly, not with 500", async () => {
      // AUTH-5: tenant binding (assertTenantMatches) now runs at the API
      // boundary before the body ever reaches requestService's own field
      // validation, so a body with no tenantId at all fails as
      // TenantMismatchError (404) rather than requestService's
      // ValidationError (400) — still a clean, typed 4xx, never a 500.
      const res = await httpPost("/requests", {});
      expect(res.status).toBe(404);
      expect(res.json).toMatchObject({ error: "TenantMismatchError" });
    });

    it("rejects a completely missing body cleanly, not with 500", async () => {
      // AUTH-5: see note above — no tenantId at all fails tenant binding
      // first (404), before requestService's own validation would run.
      const res = await httpPost("/requests", undefined);
      expect(res.status).toBe(404);
    });

    it("rejects malformed (non-JSON) body with 400, not 500", async () => {
      const res = await httpPost("/requests", undefined, "{not valid json");
      expect(res.status).toBe(400);
    });

    it("rejects null body fields cleanly, not with 500", async () => {
      // AUTH-5: tenantId: null fails tenant binding before requestService's
      // own validation ever runs — still a clean 4xx, not a 500.
      const res = await httpPost("/requests", { tenantId: null, createdById: null, lines: [] });
      expect(res.status).toBe(404);
    });

    it("rejects wrong JSON types (lines as a string instead of an array)", async () => {
      const res = await httpPost("/requests", { tenantId, createdById: procurementUserId, lines: "not-an-array" });
      expect(res.status).toBe(400);
    });

    it("rejects whitespace-only productId", async () => {
      await expect(
        requestService.createRequest({
          tenantId,
          createdById: procurementUserId,
          lines: [{ productId: "   ", requestedQuantity: 1, unit: "EA" }],
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects negative and zero requestedQuantity", async () => {
      for (const qty of [-1, 0, -0.0001]) {
        await expect(
          requestService.createRequest({
            tenantId,
            createdById: procurementUserId,
            lines: [{ productId: productAId, requestedQuantity: qty, unit: "EA" }],
          })
        ).rejects.toThrow(ValidationError);
      }
    });

    it("rejects negative and zero quotedQuantity/unitPrice on submitQuote", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: -5,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(ValidationError);
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 0,
          currency: "EUR",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects malformed decimal values ('abc', 'NaN', 'Infinity') without leaking a raw DB error", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      for (const bad of ["abc", "NaN", "Infinity", "1e400", "", "  "]) {
        await expect(
          quoteService.submitQuote({
            tenantId,
            sourcingEventId: se.id,
            supplierId: supplierAId,
            productId: productAId,
            quotedQuantity: bad,
            unit: "EA",
            unitPrice: 10,
            currency: "EUR",
          })
        ).rejects.toThrow(ValidationError);
      }
    });

    it("rejects an extremely large numeric value that would lose precision as a JS number", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      // 19 integer digits exceeds the Decimal(18,4) column's capacity.
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: "1234567890123456789",
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects malformed currency and malformed/oversized unit", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "euros!!",
        })
      ).rejects.toThrow(ValidationError);
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "a-very-long-unit-token-that-is-not-reasonable",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects nonexistent referenced IDs (product, supplier, sourcingEvent) with NotFoundError, not a raw FK error", async () => {
      const fakeId = randomUUID();
      await expect(
        requestService.createRequest({
          tenantId,
          createdById: procurementUserId,
          lines: [{ productId: fakeId, requestedQuantity: 1, unit: "EA" }],
        })
      ).rejects.toThrow(NotFoundError);

      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: fakeId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(NotFoundError);
      await expect(
        quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: fakeId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects IDs belonging to another tenant as if they did not exist", async () => {
      await expect(
        requestService.createRequest({
          tenantId,
          createdById: procurementUserId,
          lines: [{ productId: productAId, requestedQuantity: 1, unit: "EA" }],
        })
      ).resolves.toBeDefined(); // sanity: same-tenant works

      await expect(sourcingService.createSourcingEvent(otherTenantId, requestLineId)).rejects.toThrow(NotFoundError);
    });

    it("ignores unexpected extra fields rather than mass-assigning them", async () => {
      const maliciousInput = {
        tenantId,
        createdById: procurementUserId,
        lines: [{ productId: productAId, requestedQuantity: 5, unit: "EA" }],
        status: "SOMETHING_MALICIOUS",
        tenantIdOverride: otherTenantId,
      };
      const request = await requestService.createRequest(
        maliciousInput as unknown as requestService.CreateRequestInput
      );
      expect(request.tenantId).toBe(tenantId);
      expect(request.status).toBe("OPEN");
    });

    it("rejects malformed nested objects/arrays (a line that is itself an array)", async () => {
      const malformedInput = {
        tenantId,
        createdById: procurementUserId,
        lines: [["not", "an", "object"]],
      };
      await expect(
        requestService.createRequest(malformedInput as unknown as requestService.CreateRequestInput)
      ).rejects.toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------
  // Groups 2 & 3 — state transitions / CR-C boundary
  // ---------------------------------------------------------------
  describe("Groups 2 & 3 — state transitions and CR-C", () => {
    async function buildFrozenDecision(selectedQuantity: number) {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      return frozen;
    }

    it("rejects freezing an already-FROZEN DecisionPackage", async () => {
      const frozen = await buildFrozenDecision(90);
      await expect(decisionService.freezeDecisionPackage(tenantId, frozen.id, procurementUserId)).rejects.toThrow(
        InvalidStateError
      );
    });

    it("rejects revising a DecisionPackage after it has been frozen", async () => {
      const frozen = await buildFrozenDecision(90);
      await expect(
        decisionService.reviseDecision({
          tenantId,
          decisionPackageId: frozen.id,
          actingUserId: procurementUserId,
          selectedQuantity: 50,
        })
      ).rejects.toThrow(InvalidStateError);
      // and the frozen content must be unchanged
      const reread = await prisma.decisionPackage.findUniqueOrThrow({ where: { id: frozen.id } });
      expect(Number(reread.selectedQuantity)).toBe(90);
    });

    it("rejects approving a DecisionPackage that is still DRAFT (not yet frozen)", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 90,
        createdById: procurementUserId,
      });
      await expect(approvalService.approve(tenantId, draft.id, approverUserId)).rejects.toThrow(InvalidStateError);
    });

    it("rejects creating a PO from an unapproved (but frozen) DecisionPackage", async () => {
      const frozen = await buildFrozenDecision(90);
      // No Approval exists for `frozen`. Only an Approval id is accepted by
      // the PO service, so simulate the rejected attempt with a
      // nonexistent Approval id (there is no other way to even attempt
      // this through the real API, which is itself evidence of APO-D1).
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, randomUUID(), procurementUserId)
      ).rejects.toThrow(ApprovalRequiredError);
    });

    it("rejects creating a PO twice from the same Approval", async () => {
      const frozen = await buildFrozenDecision(90);
      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);
      await purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId);
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId)
      ).rejects.toThrow(InvalidStateError);
    });

    it("rejects a second Approval for the same DecisionPackage (V1 cardinality simplification)", async () => {
      const frozen = await buildFrozenDecision(90);
      await approvalService.approve(tenantId, frozen.id, approverUserId);
      await expect(approvalService.approve(tenantId, frozen.id, approverUserId)).rejects.toThrow(InvalidStateError);
    });

    it("CR-C: AI recommends 100, human revises to 90 BEFORE freeze — this is valid decision formation, not a PO transformation", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const quoteB = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierBId,
        productId: productAId,
        quotedQuantity: 80,
        unit: "EA",
        unitPrice: 9.5,
        currency: "EUR",
      });
      const recommendation = await recommendationService.generateRecommendation(tenantId, se.id);
      expect(Number(recommendation.recommendedQuantity)).toBe(100);

      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: recommendation.recommendedQuoteVersionId,
        selectedQuantity: 90, // human revision, pre-freeze — valid (CR-C)
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      expect(Number(frozen.selectedQuantity)).toBe(90);

      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);
      const po = await purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId);
      expect(Number(po.quantity)).toBe(90);

      // 90 -> 80 AFTER approval, under the same Approval, must remain
      // prohibited (CT-A1) — distinct from the pre-freeze 100 -> 90 case above.
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId, { quantity: 80 })
      ).rejects.toThrow(InvalidStateError); // PO already exists for this Approval — see next test for the pure-deviation case

      void quoteB; // Supplier B's quote exists only to make this a realistic multi-quote scenario.
    });
  });

  // ---------------------------------------------------------------
  // Group 4 — CR-A / CR-B / commercial correspondence
  // ---------------------------------------------------------------
  describe("Group 4 — commercial correspondence (CR-A / CR-B / CT-A1)", () => {
    async function buildApproval(selectedQuantity = 90, unitPrice: number | undefined = undefined) {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity,
        unitPrice,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      return approvalService.approve(tenantId, frozen.id, approverUserId);
    }

    it("rejects 90 EA -> 80 EA", async () => {
      const approval = await buildApproval(90);
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId, { quantity: 80 })
      ).rejects.toThrow(CommercialDeviationError);
    });

    it("rejects 90 EA -> 100 EA", async () => {
      const approval = await buildApproval(90);
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId, { quantity: 100 })
      ).rejects.toThrow(CommercialDeviationError);
    });

    it("rejects EUR 10 -> EUR 9.50 and EUR 10 -> EUR 11", async () => {
      const approvalLow = await buildApproval(90);
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approvalLow.id, procurementUserId, { unitPrice: 9.5 })
      ).rejects.toThrow(CommercialDeviationError);

      const approvalHigh = await buildApproval(90);
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approvalHigh.id, procurementUserId, { unitPrice: 11 })
      ).rejects.toThrow(CommercialDeviationError);
    });

    it("the PO creation entry point has no parameter for supplier, product, unit, or currency at all — there is no code path to attempt EUR->USD, EA->incompatible-unit, Supplier A->B, or Product A->B overrides", async () => {
      const approval = await buildApproval(90);
      // purchaseOrderService.createPurchaseOrderFromApproval's signature
      // is (tenantId, approvalId, actingUserId, testOnlyDeviationAttempt?)
      // where testOnlyDeviationAttempt only has `quantity`/`unitPrice`
      // fields. Supplier/product/unit/currency cannot be passed at all —
      // this is verified structurally (by the type signature itself,
      // checked at compile time) rather than by a runtime check, which
      // is a stronger guarantee than a check that could be forgotten.
      const po = await purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId);
      expect(po.supplierId).toBe(supplierAId);
      expect(po.productId).toBe(productAId);
      expect(po.currency).toBe("EUR");
      expect(po.unit).toBe("EA");
    });
  });

  // ---------------------------------------------------------------
  // Group 5 — Q3 (same-unit exact correspondence only)
  // ---------------------------------------------------------------
  describe("Group 5 — Q3 same-unit correspondence", () => {
    it("Selected 90 EA -> PO 90 EA succeeds; 90 EA -> 80/100 EA do not silently pass", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 90,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

      const po = await purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId);
      expect(Number(po.quantity)).toBe(90);
    });
  });

  // ---------------------------------------------------------------
  // Group 6 — APO-D1 / APO-D2
  // ---------------------------------------------------------------
  describe("Group 6 — APO-D1 / APO-D2", () => {
    it("no Approval -> no PO (fabricated id)", async () => {
      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, randomUUID(), procurementUserId)
      ).rejects.toThrow(ApprovalRequiredError);
    });

    it("Approval belonging to another tenant is rejected as if it did not exist", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 90,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(otherTenantId, approval.id, otherTenantUserId)
      ).rejects.toThrow(ApprovalRequiredError);
    });
  });

  // ---------------------------------------------------------------
  // Group 7 — Tenant isolation (every relevant entity, read + mutate)
  // ---------------------------------------------------------------
  describe("Group 7 — tenant isolation", () => {
    it("RequestLine/SourcingEvent: cross-tenant mutation is rejected", async () => {
      await expect(sourcingService.createSourcingEvent(otherTenantId, requestLineId)).rejects.toThrow(NotFoundError);
    });

    it("Supplier/Product referenced cross-tenant in a quote are rejected", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      // otherTenantId has no Supplier/Product of its own matching these ids
      await expect(
        quoteService.submitQuote({
          tenantId: otherTenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId, // belongs to tenantId, not otherTenantId
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("Quote/QuoteVersion read access does not leak across tenants", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const crossTenantRead = await quoteService.listQuoteVersionsForSourcingEvent(otherTenantId, se.id);
      expect(crossTenantRead).toHaveLength(0);
    });

    it("Recommendation generation cannot be triggered cross-tenant", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      await expect(recommendationService.generateRecommendation(otherTenantId, se.id)).rejects.toThrow(NotFoundError);
    });

    it("DecisionPackage formation/freeze cannot be performed cross-tenant", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      await expect(
        decisionService.formDecision({
          tenantId: otherTenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: otherTenantUserId,
        })
      ).rejects.toThrow(NotFoundError);

      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      await expect(decisionService.freezeDecisionPackage(otherTenantId, draft.id, otherTenantUserId)).rejects.toThrow(
        NotFoundError
      );
    });

    it("Approval cannot be granted cross-tenant", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      await expect(approvalService.approve(otherTenantId, frozen.id, otherTenantUserId)).rejects.toThrow(NotFoundError);
    });

    it("PurchaseOrder cannot be created cross-tenant even with a correct Approval id", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

      await expect(
        purchaseOrderService.createPurchaseOrderFromApproval(otherTenantId, approval.id, otherTenantUserId)
      ).rejects.toThrow(ApprovalRequiredError);
    });
  });

  // ---------------------------------------------------------------
  // Group 8 — Authorization
  // ---------------------------------------------------------------
  describe("Group 8 — authorization", () => {
    it("a procurement_user cannot approve (requires 'approver')", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      await expect(approvalService.approve(tenantId, frozen.id, procurementUserId)).rejects.toThrow(AuthorizationError);
    });

    it("a user with a malformed/unknown role cannot freeze or approve", async () => {
      const weirdRoleUser = await prisma.user.create({ data: { tenantId, name: "Weird Role", role: "banana" } });
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      await expect(decisionService.freezeDecisionPackage(tenantId, draft.id, weirdRoleUser.id)).rejects.toThrow(
        AuthorizationError
      );
    });

    it("a nonexistent actingUserId is rejected (not authorization-bypassed)", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      await expect(decisionService.freezeDecisionPackage(tenantId, draft.id, randomUUID())).rejects.toThrow(
        NotFoundError
      );
    });

    it("another tenant's approver cannot approve this tenant's DecisionPackage merely by supplying their own (valid-elsewhere) id", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      // otherTenantUserId is a real "approver" row, but in otherTenantId.
      await expect(approvalService.approve(tenantId, frozen.id, otherTenantUserId)).rejects.toThrow(NotFoundError);
    });
  });

  // ---------------------------------------------------------------
  // Group 9 — Duplication / idempotency
  // ---------------------------------------------------------------
  describe("Group 9 — duplication / idempotency", () => {
    it("submitting the same quote twice creates two independent SupplierQuote/QuoteVersion rows (safely repeatable, not deduplicated)", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const payload = {
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      };
      const first = await quoteService.submitQuote(payload);
      const second = await quoteService.submitQuote(payload);
      expect(first.id).not.toBe(second.id);
      // Each SupplierQuote starts its own versionNumber=1 — V1 does not
      // treat "the same supplier quoting the same terms twice" as a
      // revision of one quote. See "Business/domain questions" in the
      // final report: whether it SHOULD be deduplicated/versioned is a
      // genuinely open product question, not resolved here.
    });

    it("freezing twice is rejected (already covered structurally above) — repeated here as an explicit idempotency classification: NOT safely repeatable", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      await expect(decisionService.freezeDecisionPackage(tenantId, frozen.id, procurementUserId)).rejects.toThrow(
        InvalidStateError
      );
    });
  });

  // ---------------------------------------------------------------
  // Group 10 — Concurrency
  // ---------------------------------------------------------------
  describe("Group 10 — concurrency", () => {
    it("two concurrent freeze attempts on the same DecisionPackage: exactly one succeeds", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });

      const results = await Promise.allSettled([
        decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId),
        decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);
    });

    it("two concurrent approval attempts on the same DecisionPackage: exactly one succeeds", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);

      const results = await Promise.allSettled([
        approvalService.approve(tenantId, frozen.id, approverUserId),
        approvalService.approve(tenantId, frozen.id, approverUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);

      const approvalCount = await prisma.approval.count({ where: { decisionPackageId: frozen.id } });
      expect(approvalCount).toBe(1);
    });

    it("two concurrent PO-creation attempts from the same Approval: exactly one PO is ever created", async () => {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: procurementUserId,
      });
      const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
      const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

      const results = await Promise.allSettled([
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId),
        purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const poCount = await prisma.purchaseOrder.count({ where: { approvalId: approval.id } });
      expect(poCount).toBe(1);
    });

    it("two concurrent attempts to open a SourcingEvent on the same RequestLine: exactly one succeeds (RL-C3)", async () => {
      const dedicatedRequest = await requestService.createRequest({
        tenantId,
        createdById: procurementUserId,
        lines: [{ productId: productAId, requestedQuantity: 1, unit: "EA" }],
      });
      const lineId = dedicatedRequest.lines[0].id;

      const results = await Promise.allSettled([
        sourcingService.createSourcingEvent(tenantId, lineId),
        sourcingService.createSourcingEvent(tenantId, lineId),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const openCount = await prisma.sourcingEvent.count({ where: { requestLineId: lineId, status: "OPEN" } });
      expect(openCount).toBe(1);
    });

    // NOTE on scope: these tests exercise exactly two concurrent callers
    // against a real PostgreSQL instance via Prisma's connection pool —
    // they are not a load/stress test, and higher concurrency (dozens of
    // simultaneous callers), connection-pool exhaustion behavior, and
    // long-running-transaction lock contention are NOT verified here.
    // See "Concurrency findings" in the final report.
  });

  // ---------------------------------------------------------------
  // Group 11 — reviseDecision actor/tenant-membership enforcement (AUTH-4)
  // ---------------------------------------------------------------
  // reviseDecision previously accepted no actor identity at all and
  // performed no check — unlike every other mutating service in this
  // codebase, which at minimum verifies the acting user exists within the
  // claimed tenant. These tests prove the fix follows the same bare
  // existence-in-tenant pattern formDecision already uses (not the
  // role-gated assertActorAuthorized pattern used by freeze/approve/PO
  // creation — revision remains unrestricted by role in V1).
  describe("Group 11 — reviseDecision actor/tenant-membership enforcement (AUTH-4)", () => {
    async function buildDraftDecision(selectedQuantity = 90) {
      const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
      const quote = await quoteService.submitQuote({
        tenantId,
        sourcingEventId: se.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 100,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      return decisionService.formDecision({
        tenantId,
        sourcingEventId: se.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity,
        createdById: procurementUserId,
      });
    }

    it("a valid actor belonging to the tenant can revise a DRAFT DecisionPackage", async () => {
      const draft = await buildDraftDecision(90);
      const revised = await decisionService.reviseDecision({
        tenantId,
        decisionPackageId: draft.id,
        actingUserId: procurementUserId,
        selectedQuantity: 70,
      });
      expect(Number(revised.selectedQuantity)).toBe(70);
    });

    it("an actor belonging to another tenant cannot revise it, even with a real (valid-elsewhere) user id", async () => {
      const draft = await buildDraftDecision(90);
      await expect(
        decisionService.reviseDecision({
          tenantId,
          decisionPackageId: draft.id,
          actingUserId: otherTenantUserId, // real User row, but tenantId = otherTenantId
          selectedQuantity: 70,
        })
      ).rejects.toThrow(NotFoundError);

      const reread = await prisma.decisionPackage.findUniqueOrThrow({ where: { id: draft.id } });
      expect(Number(reread.selectedQuantity)).toBe(90);
    });

    it("an unknown actor cannot revise it", async () => {
      const draft = await buildDraftDecision(90);
      await expect(
        decisionService.reviseDecision({
          tenantId,
          decisionPackageId: draft.id,
          actingUserId: randomUUID(),
          selectedQuantity: 70,
        })
      ).rejects.toThrow(NotFoundError);

      const reread = await prisma.decisionPackage.findUniqueOrThrow({ where: { id: draft.id } });
      expect(Number(reread.selectedQuantity)).toBe(90);
    });

    it("a missing actingUserId is rejected with ValidationError, not silently allowed", async () => {
      const draft = await buildDraftDecision(90);
      await expect(
        decisionService.reviseDecision({
          tenantId,
          decisionPackageId: draft.id,
          selectedQuantity: 70,
        } as unknown as decisionService.ReviseDecisionInput)
      ).rejects.toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------
  // Group 12 — Error handling (HTTP-level, status/shape consistency)
  // ---------------------------------------------------------------
  describe("Group 12 — error handling consistency", () => {
    it("every tested invalid HTTP path returns a JSON {error, message} shape, never a raw stack trace", async () => {
      const paths: Array<[string, unknown]> = [
        ["/requests", {}],
        ["/sourcing-events", { tenantId, requestLineId: randomUUID() }],
        ["/quotes", { tenantId }],
        ["/recommendations", { tenantId, sourcingEventId: randomUUID() }],
        ["/decisions", { tenantId }],
        ["/approvals", { tenantId, decisionPackageId: randomUUID(), approvedById: approverUserId }],
        ["/purchase-orders", { tenantId, approvalId: randomUUID(), actingUserId: procurementUserId }],
      ];
      for (const [path, body] of paths) {
        const res = await httpPost(path, body);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(res.json).toHaveProperty("error");
        expect(res.json).toHaveProperty("message");
        expect(typeof (res.json as { message: unknown }).message).toBe("string");
        expect((res.json as { message: string }).message).not.toMatch(/at Object\.|at Module\._compile|node_modules/);
      }
    });
  });

  // ---------------------------------------------------------------
  // Group 13 — Authentication boundary (AUTH-1/2/3/5/6 planning, Step 4)
  // ---------------------------------------------------------------
  // Scope note: this step establishes AUTHENTICATION only — every HTTP
  // route now requires a known Principal, via the test authenticator
  // configured in beforeAll. It deliberately does NOT yet verify that a
  // request's claimed tenantId matches the authenticated principal's own
  // tenantId (that is tenantBinding.ts, wired in a later step), and it
  // does NOT yet replace body-supplied actingUserId/approvedById/
  // createdById with the principal (also a later step) — those routes'
  // existing, unchanged behavior is already covered by every test above
  // this group, which all now implicitly prove "authenticated as the
  // default test principal, behaves exactly as before."
  describe("Group 13 — authentication boundary", () => {
    it("A (read): an unauthenticated GET /tenants is rejected with 401, not served", async () => {
      const res = await httpGet("/tenants", null);
      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ error: "Unauthenticated" });
      expect((res.json as { message: string }).message).not.toMatch(/at Object\.|at Module\._compile|node_modules/);
    });

    it("A (write): an unauthenticated POST /requests is rejected with 401, not forwarded to the route", async () => {
      const res = await httpPost(
        "/requests",
        { tenantId, createdById: procurementUserId, lines: [{ productId: productAId, requestedQuantity: 1, unit: "EA" }] },
        undefined,
        null
      );
      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({ error: "Unauthenticated" });
    });

    it("B: an authenticated request with a valid test Principal reaches the existing route and behaves exactly as before", async () => {
      const res = await httpGet("/tenants");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });

    it("C: a Principal belonging to another tenant cannot claim this tenant — updated by AUTH-5 (Step 5): tenant binding is now enforced, where Step 4 deliberately left it open", async () => {
      // Superseded by Step 5: this test originally proved only that
      // authentication succeeded regardless of the claimed tenant (the
      // explicit gap Step 4 documented as "not yet implemented"). Now that
      // assertTenantMatches is wired into this route, authenticating as
      // otherTenantId's user while claiming tenantId must be rejected.
      const res = await httpGet(`/requests?tenantId=${tenantId}`, {
        [TEST_USER_ID_HEADER]: otherTenantUserId,
        [TEST_TENANT_ID_HEADER]: otherTenantId,
      });
      expect(res.status).toBe(404);
      expect(res.json).toMatchObject({ error: "TenantMismatchError" });
    });
  });

  // ---------------------------------------------------------------
  // Group 14 — Tenant binding + trusted actor identity (AUTH-5)
  // ---------------------------------------------------------------
  // Closes the two gaps Group 13 (Step 4) explicitly left open: (1) a
  // request's claimed tenantId is now verified against the authenticated
  // principal's own tenantId via assertTenantMatches, at the API boundary,
  // before any service is called; (2) actingUserId/approvedById/createdById
  // are no longer read from the request body as the source of truth — the
  // route derives them from req.principal instead, so a spoofed body value
  // has no effect, verified below via persisted attribution (createdById)
  // or authorization behavior (role checks binding to the true principal),
  // per which of the two actually applies to each route.
  describe("Group 14 — tenant binding + trusted actor identity (AUTH-5)", () => {
    describe("Tenant binding", () => {
      it("authenticated principal with a matching claimed tenantId succeeds", async () => {
        const res = await httpGet(`/tenants/${tenantId}/context`);
        expect(res.status).toBe(200);
      });

      it("authenticated principal from another tenant claiming this tenant is rejected (read, GET /tenants/:id/context)", async () => {
        const res = await httpGet(`/tenants/${tenantId}/context`, {
          [TEST_USER_ID_HEADER]: otherTenantUserId,
          [TEST_TENANT_ID_HEADER]: otherTenantId,
        });
        expect(res.status).toBe(404);
        expect(res.json).toMatchObject({ error: "TenantMismatchError" });
      });

      it("a cross-tenant read (another tenant's Principal) via GET /request-lines/:id/workflow is rejected", async () => {
        const res = await httpGet(`/request-lines/${requestLineId}/workflow?tenantId=${tenantId}`, {
          [TEST_USER_ID_HEADER]: otherTenantUserId,
          [TEST_TENANT_ID_HEADER]: otherTenantId,
        });
        expect(res.status).toBe(404);
        expect(res.json).toMatchObject({ error: "TenantMismatchError" });
      });

      it("a cross-tenant write (another tenant's Principal) via POST /sourcing-events is rejected, and nothing is created", async () => {
        const line = await freshLineId();
        const res = await httpPost("/sourcing-events", { tenantId, requestLineId: line }, undefined, {
          [TEST_USER_ID_HEADER]: otherTenantUserId,
          [TEST_TENANT_ID_HEADER]: otherTenantId,
        });
        expect(res.status).toBe(404);
        expect(res.json).toMatchObject({ error: "TenantMismatchError" });
        const count = await prisma.sourcingEvent.count({ where: { requestLineId: line } });
        expect(count).toBe(0);
      });
    });

    describe("Actor identity spoofing", () => {
      it("createdById spoofing: POST /requests ignores a body-supplied createdById and attributes to the authenticated principal", async () => {
        const res = await httpPost("/requests", {
          tenantId,
          createdById: approverUserId, // spoof attempt: a different real user, same tenant
          lines: [{ productId: productAId, requestedQuantity: 1, unit: "EA" }],
        }); // default headers authenticate as procurementUserId
        expect(res.status).toBe(200);
        expect((res.json as { createdById: string }).createdById).toBe(procurementUserId);
        expect((res.json as { createdById: string }).createdById).not.toBe(approverUserId);
      });

      it("createdById spoofing: POST /decisions ignores a body-supplied createdById and attributes to the authenticated principal", async () => {
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const res = await httpPost("/decisions", {
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: approverUserId, // spoof attempt
        });
        expect(res.status).toBe(200);
        expect((res.json as { createdById: string }).createdById).toBe(procurementUserId);
      });

      it("approvedById spoofing: a non-approver authenticated principal cannot approve by spoofing a real approver's id in the body", async () => {
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const draft = await decisionService.formDecision({
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: procurementUserId,
        });
        const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);

        const res = await httpPost("/approvals", {
          tenantId,
          decisionPackageId: frozen.id,
          approvedById: approverUserId, // spoof attempt: a real approver, not the caller
        }); // default headers authenticate as procurementUserId (role=procurement_user)
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ error: "AuthorizationError" });

        const count = await prisma.approval.count({ where: { decisionPackageId: frozen.id } });
        expect(count).toBe(0);
      });

      it("approvedById spoofing: when an authenticated approver DOES approve, the persisted approvedById is the principal, not any spoofed body value", async () => {
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const draft = await decisionService.formDecision({
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: procurementUserId,
        });
        const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);

        const res = await httpPost(
          "/approvals",
          { tenantId, decisionPackageId: frozen.id, approvedById: procurementUserId }, // spoof attempt
          undefined,
          { [TEST_USER_ID_HEADER]: approverUserId, [TEST_TENANT_ID_HEADER]: tenantId } // authenticated as the real approver
        );
        expect(res.status).toBe(200);
        expect((res.json as { approvedById: string }).approvedById).toBe(approverUserId);
        expect((res.json as { approvedById: string }).approvedById).not.toBe(procurementUserId);
      });

      it("actingUserId spoofing: PATCH /decisions/:id ignores a body-supplied actingUserId (even a real user in a different tenant) and succeeds via the authenticated principal instead", async () => {
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const draft = await decisionService.formDecision({
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: procurementUserId,
        });

        const res = await httpPatch(`/decisions/${draft.id}`, {
          tenantId,
          actingUserId: otherTenantUserId, // spoof attempt: real user, wrong tenant — would fail AUTH-4's own check if actually used
          selectedQuantity: 3,
        }); // default headers authenticate as procurementUserId
        expect(res.status).toBe(200);
        expect(Number((res.json as { selectedQuantity: string }).selectedQuantity)).toBe(3);
      });

      it("actingUserId spoofing: a principal with neither allowed role cannot freeze by spoofing a valid user's id in the body", async () => {
        const weirdRoleUser = await prisma.user.create({ data: { tenantId, name: "AUTH-5 Weird Role (freeze)", role: "banana" } });
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const draft = await decisionService.formDecision({
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: procurementUserId,
        });

        const res = await httpPost(
          `/decisions/${draft.id}/freeze`,
          { tenantId, actingUserId: procurementUserId }, // spoof attempt: a real, allowed-role user
          undefined,
          { [TEST_USER_ID_HEADER]: weirdRoleUser.id, [TEST_TENANT_ID_HEADER]: tenantId }
        );
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ error: "AuthorizationError" });

        const reread = await prisma.decisionPackage.findUniqueOrThrow({ where: { id: draft.id } });
        expect(reread.status).toBe("DRAFT");
      });

      it("actingUserId spoofing: a principal with neither allowed role cannot create a PurchaseOrder by spoofing a valid user's id in the body", async () => {
        const weirdRoleUser = await prisma.user.create({ data: { tenantId, name: "AUTH-5 Weird Role (PO)", role: "banana" } });
        const se = await sourcingService.createSourcingEvent(tenantId, await freshLineId());
        const quote = await quoteService.submitQuote({
          tenantId,
          sourcingEventId: se.id,
          supplierId: supplierAId,
          productId: productAId,
          quotedQuantity: 10,
          unit: "EA",
          unitPrice: 10,
          currency: "EUR",
        });
        const draft = await decisionService.formDecision({
          tenantId,
          sourcingEventId: se.id,
          sourceQuoteVersionId: quote.versions[0].id,
          selectedQuantity: 5,
          createdById: procurementUserId,
        });
        const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
        const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

        const res = await httpPost(
          "/purchase-orders",
          { tenantId, approvalId: approval.id, actingUserId: procurementUserId }, // spoof attempt
          undefined,
          { [TEST_USER_ID_HEADER]: weirdRoleUser.id, [TEST_TENANT_ID_HEADER]: tenantId }
        );
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ error: "AuthorizationError" });

        const po = await prisma.purchaseOrder.findUnique({ where: { approvalId: approval.id } });
        expect(po).toBeNull();
      });
    });
  });
});
