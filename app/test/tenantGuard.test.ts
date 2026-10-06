import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, tenantScoped, TenantContextMissingError, TenantGuardRejection } from "../src/db/client";
import * as decisionService from "../src/services/decisionService";
import * as approvalService from "../src/services/approvalService";
import * as requestService from "../src/services/requestService";
import * as sourcingService from "../src/services/sourcingService";
import * as quoteService from "../src/services/quoteService";
import { assertActorAuthorized, AuthorizationError } from "../src/domain/authorization";

// SEC-012 / R15 (docs/decisions/ratified.md) — runtime tenant guard.
//
// These tests exercise the guard itself, directly, against the real test
// database — not mocked — because the guard's whole purpose is to behave
// correctly against real Prisma query execution (including real
// transactions and real fetched results), not against a stand-in. This
// file is independent of adversarial.test.ts (which proves tenant
// isolation at the service-function level, i.e. the still-primary
// enforcement layer per R10) — this file instead proves the NEW
// defense-in-depth backstop fires on its own terms, including the exact
// scenario that motivated it (decisionService.ts's bare
// findUniqueOrThrow({ where: { id } }) calls).
describe("SEC-012 / R15 — runtime tenant guard (db/client.ts tenantScoped)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let productAId: string;
  let supplierAId: string;

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "TenantGuard Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "TenantGuard Tenant B" } });
    tenantBId = tenantB.id;

    userAId = (await prisma.user.create({ data: { tenantId: tenantAId, name: "Guard User A", role: "procurement_user" } })).id;
    productAId = (await prisma.product.create({ data: { tenantId: tenantAId, name: "Guard Product A", sku: "GUARD-A" } })).id;
    supplierAId = (await prisma.supplier.create({ data: { tenantId: tenantAId, name: "Guard Supplier A" } })).id;
  });

  // ---------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------
  describe("tenant context", () => {
    it("throws TenantContextMissingError for an empty tenantId", () => {
      expect(() => tenantScoped("")).toThrow(TenantContextMissingError);
    });
  });

  // ---------------------------------------------------------------
  // Global models — pass through untouched, even with a mismatched context
  // ---------------------------------------------------------------
  describe("global models (Tenant, ExternalIdentity, Session) pass through unguarded", () => {
    it("Tenant.findUnique by id succeeds through tenantScoped(), regardless of the bound tenantId", async () => {
      const db = tenantScoped(tenantAId);
      const found = await db.tenant.findUnique({ where: { id: tenantBId } });
      expect(found?.id).toBe(tenantBId);
    });

    it("Tenant.create succeeds through tenantScoped() with no tenantId field at all", async () => {
      const db = tenantScoped(tenantAId);
      const created = await db.tenant.create({ data: { name: "Guard Global Passthrough Tenant" } });
      expect(created.id).toBeDefined();
      await prisma.tenant.delete({ where: { id: created.id } });
    });
  });

  // ---------------------------------------------------------------
  // Reads — pre-check against where.tenantId
  // ---------------------------------------------------------------
  describe("reads: findFirst/findMany/count (pre-check against where.tenantId)", () => {
    it("findFirst with a matching where.tenantId succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const found = await db.user.findFirst({ where: { id: userAId, tenantId: tenantAId } });
      expect(found?.id).toBe(userAId);
    });

    it("findFirst with a mismatched where.tenantId is rejected", async () => {
      const db = tenantScoped(tenantBId);
      await expect(db.user.findFirst({ where: { id: userAId, tenantId: tenantAId } })).rejects.toThrow(TenantGuardRejection);
    });

    it("findMany missing a where.tenantId filter entirely is rejected", async () => {
      const db = tenantScoped(tenantAId);
      await expect(db.user.findMany({ where: { name: "Guard User A" } })).rejects.toThrow(TenantGuardRejection);
    });

    it("count with a matching where.tenantId succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const n = await db.user.count({ where: { tenantId: tenantAId } });
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it("count with a mismatched where.tenantId is rejected", async () => {
      const db = tenantScoped(tenantBId);
      await expect(db.user.count({ where: { tenantId: tenantAId } })).rejects.toThrow(TenantGuardRejection);
    });
  });

  // ---------------------------------------------------------------
  // Writes — create/createMany, including nested writes
  // ---------------------------------------------------------------
  describe("writes: create/createMany (pre-check against data.tenantId)", () => {
    it("create with a matching data.tenantId succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const product = await db.product.create({ data: { tenantId: tenantAId, name: "Guard Create OK", sku: "GUARD-CREATE-OK" } });
      expect(product.tenantId).toBe(tenantAId);
    });

    it("create with a mismatched data.tenantId is rejected", async () => {
      const db = tenantScoped(tenantBId);
      await expect(
        db.product.create({ data: { tenantId: tenantAId, name: "Guard Create Bad", sku: "GUARD-CREATE-BAD" } })
      ).rejects.toThrow(TenantGuardRejection);
    });

    it("create missing data.tenantId entirely is rejected", async () => {
      const db = tenantScoped(tenantAId);
      await expect(
        db.product.create({ data: { name: "Guard Create Missing", sku: "GUARD-CREATE-MISSING" } as never })
      ).rejects.toThrow(TenantGuardRejection);
    });

    it("createMany with every row's tenantId matching succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const result = await db.product.createMany({
        data: [
          { tenantId: tenantAId, name: "Guard CreateMany 1", sku: "GUARD-CM-1" },
          { tenantId: tenantAId, name: "Guard CreateMany 2", sku: "GUARD-CM-2" },
        ],
      });
      expect(result.count).toBe(2);
    });

    it("createMany with one row's tenantId mismatched is rejected (and nothing is inserted)", async () => {
      const db = tenantScoped(tenantAId);
      await expect(
        db.product.createMany({
          data: [
            { tenantId: tenantAId, name: "Guard CreateMany OK", sku: "GUARD-CM-MIX-OK" },
            { tenantId: tenantBId, name: "Guard CreateMany Bad", sku: "GUARD-CM-MIX-BAD" },
          ],
        })
      ).rejects.toThrow(TenantGuardRejection);
      const leaked = await prisma.product.findFirst({ where: { sku: "GUARD-CM-MIX-OK" } });
      expect(leaked).toBeNull();
    });

    // Nested writes (e.g. procurementRequest.create({ data: { lines: { create: [...] } } }))
    // are invisible to $allOperations — verified empirically: a probe
    // extension recorded exactly one call for such a write (the parent
    // operation only). validateNestedCreates (db/client.ts) exists
    // specifically to close that gap; these two tests exercise it through
    // the real service functions that perform nested writes.
    it("nested create (requestService's lines.create) with a correct nested tenantId succeeds", async () => {
      const request = await requestService.createRequest({
        tenantId: tenantAId,
        createdById: userAId,
        lines: [{ productId: productAId, requestedQuantity: 5, unit: "EA" }],
      });
      expect(request.lines[0].tenantId).toBe(tenantAId);
    });

    it("a nested create row with a mismatched tenantId is rejected, even though the top-level data.tenantId is correct", async () => {
      const db = tenantScoped(tenantAId);
      await expect(
        db.procurementRequest.create({
          data: {
            tenantId: tenantAId,
            createdById: userAId,
            lines: { create: [{ tenantId: tenantBId, productId: productAId, requestedQuantity: "5", unit: "EA" }] },
          },
        })
      ).rejects.toThrow(TenantGuardRejection);
    });
  });

  // ---------------------------------------------------------------
  // Unique-only mutations — rejected outright (update/delete/upsert)
  // ---------------------------------------------------------------
  describe("unique-only mutations (update/delete/upsert) are rejected outright for tenant-scoped models", () => {
    it("update is rejected", async () => {
      const db = tenantScoped(tenantAId);
      await expect(db.product.update({ where: { id: productAId }, data: { name: "x" } })).rejects.toThrow(
        TenantGuardRejection
      );
    });

    it("delete is rejected", async () => {
      const db = tenantScoped(tenantAId);
      await expect(db.product.delete({ where: { id: productAId } })).rejects.toThrow(TenantGuardRejection);
    });

    it("upsert is rejected", async () => {
      const db = tenantScoped(tenantAId);
      await expect(
        db.product.upsert({
          where: { id: productAId },
          create: { tenantId: tenantAId, name: "x", sku: "GUARD-UPSERT" },
          update: { name: "x" },
        })
      ).rejects.toThrow(TenantGuardRejection);
    });
  });

  // ---------------------------------------------------------------
  // Unique-lookup reads — post-fetch result check (findUnique/findUniqueOrThrow)
  // ---------------------------------------------------------------
  describe("findUnique/findUniqueOrThrow (post-fetch result-tenantId check)", () => {
    it("findUnique on a same-tenant row succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const found = await db.product.findUnique({ where: { id: productAId } });
      expect(found?.id).toBe(productAId);
    });

    it("findUnique on a cross-tenant row returns null (treated as not-found)", async () => {
      const db = tenantScoped(tenantBId);
      const found = await db.product.findUnique({ where: { id: productAId } });
      expect(found).toBeNull();
    });

    it("findUniqueOrThrow on a same-tenant row succeeds", async () => {
      const db = tenantScoped(tenantAId);
      const found = await db.product.findUniqueOrThrow({ where: { id: productAId } });
      expect(found.id).toBe(productAId);
    });

    it("findUniqueOrThrow on a cross-tenant row throws TenantGuardRejection, not the row", async () => {
      const db = tenantScoped(tenantBId);
      await expect(db.product.findUniqueOrThrow({ where: { id: productAId } })).rejects.toThrow(TenantGuardRejection);
    });

    // This is the exact, explicitly-named regression scenario that
    // motivated R15: decisionService.ts's formDecision/freezeDecisionPackage
    // both end with a bare `findUniqueOrThrow({ where: { id } })` relying
    // only on the preceding tenant-validated write in the same function.
    // This proves that if a DecisionPackage id belonging to a different
    // tenant were ever passed into that call — the exact shape of a bug
    // the service layer's own primary enforcement is supposed to prevent
    // — the guard backstop catches it, rather than silently returning
    // another tenant's DecisionPackage.
    it("REGRESSION: decisionPackage.findUniqueOrThrow({ where: { id } }) with tenant A's context and tenant B's DecisionPackage id is rejected", async () => {
      const otherTenantProduct = await prisma.product.create({
        data: { tenantId: tenantBId, name: "Guard Other Tenant Product", sku: "GUARD-OTHER-PRODUCT" },
      });
      const otherTenantSupplier = await prisma.supplier.create({
        data: { tenantId: tenantBId, name: "Guard Other Tenant Supplier" },
      });
      const otherTenantUser = await prisma.user.create({
        data: { tenantId: tenantBId, name: "Guard Other Tenant User", role: "procurement_user" },
      });
      const request = await prisma.procurementRequest.create({
        data: { tenantId: tenantBId, createdById: otherTenantUser.id },
      });
      const line = await prisma.requestLine.create({
        data: { tenantId: tenantBId, requestId: request.id, productId: otherTenantProduct.id, requestedQuantity: "10", unit: "EA" },
      });
      const sourcingEvent = await prisma.sourcingEvent.create({
        data: { tenantId: tenantBId, requestLineId: line.id, status: "OPEN" },
      });
      const supplierQuote = await prisma.supplierQuote.create({
        data: { tenantId: tenantBId, sourcingEventId: sourcingEvent.id, supplierId: otherTenantSupplier.id },
      });
      const quoteVersion = await prisma.quoteVersion.create({
        data: {
          tenantId: tenantBId,
          supplierQuoteId: supplierQuote.id,
          versionNumber: 1,
          productId: otherTenantProduct.id,
          quotedQuantity: "10",
          unit: "EA",
          unitPrice: "1",
          currency: "EUR",
        },
      });
      const otherTenantDecisionPackage = await prisma.decisionPackage.create({
        data: {
          tenantId: tenantBId,
          sourcingEventId: sourcingEvent.id,
          sourceQuoteVersionId: quoteVersion.id,
          supplierId: otherTenantSupplier.id,
          productId: otherTenantProduct.id,
          selectedQuantity: "10",
          unit: "EA",
          unitPrice: "1",
          currency: "EUR",
          status: "DRAFT",
          createdById: otherTenantUser.id,
        },
      });

      const db = tenantScoped(tenantAId);
      await expect(
        db.decisionPackage.findUniqueOrThrow({ where: { id: otherTenantDecisionPackage.id } })
      ).rejects.toThrow(TenantGuardRejection);
    });
  });

  // ---------------------------------------------------------------
  // Transactions — tenantScoped(...).$transaction
  // ---------------------------------------------------------------
  describe("transactions (tenantScoped(...).$transaction)", () => {
    it("a transaction whose operations all match the bound tenant succeeds end-to-end", async () => {
      const line = await buildFreshRequestLine();
      const sourcingEvent = await sourcingService.createSourcingEvent(tenantAId, line.id);
      expect(sourcingEvent.tenantId).toBe(tenantAId);
    });

    it("a transaction is rejected, and fully rolled back, if an operation inside it violates the guard", async () => {
      const db = tenantScoped(tenantAId);
      const marker = `GUARD-TX-ROLLBACK-${randomUUID()}`;
      await expect(
        db.$transaction(async (tx) => {
          await tx.product.create({ data: { tenantId: tenantAId, name: marker, sku: marker } });
          // This nested call is bound to tenantAId's db, but the row below
          // claims tenantBId — must be rejected, rolling back the create above too.
          await tx.product.create({ data: { tenantId: tenantBId, name: "should not persist", sku: `${marker}-2` } });
        })
      ).rejects.toThrow(TenantGuardRejection);

      const persisted = await prisma.product.findFirst({ where: { sku: marker } });
      expect(persisted).toBeNull();
    });

    it("RL-C3 concurrency (two concurrent createSourcingEvent calls on one RequestLine) still behaves correctly through tenantScoped($transaction)", async () => {
      const line = await buildFreshRequestLine();
      const results = await Promise.allSettled([
        sourcingService.createSourcingEvent(tenantAId, line.id),
        sourcingService.createSourcingEvent(tenantAId, line.id),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      const openCount = await prisma.sourcingEvent.count({ where: { requestLineId: line.id, status: "OPEN" } });
      expect(openCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // SEC-012/R15 completeness fix — the authorization hot-path
  // (domain/authorization.ts's assertActorAuthorized, called from
  // approvalService.approve, decisionService.freezeDecisionPackage, and
  // purchaseOrderService.createPurchaseOrderFromApproval) now routes its
  // own tenant-scoped User lookup through tenantScoped() instead of the
  // bare prisma client.
  // ---------------------------------------------------------------
  describe("authorization hot-path (domain/authorization.ts assertActorAuthorized) is guard-wired", () => {
    it("a same-tenant, correctly-roled actor still resolves normally (regression)", async () => {
      const user = await assertActorAuthorized(tenantAId, userAId, ["procurement_user"]);
      expect(user.id).toBe(userAId);
    });

    it("a same-tenant actor with the wrong role still throws AuthorizationError, not the guard (regression)", async () => {
      await expect(assertActorAuthorized(tenantAId, userAId, ["approver"])).rejects.toThrow(AuthorizationError);
    });

    // A bare prisma.user.findFirst({ where: { id, tenantId: "" } }) would
    // simply execute the query and return no match (NotFoundError) for an
    // empty tenantId — it has no concept of "missing tenant context." Only
    // the SEC-012 guard itself throws TenantContextMissingError before any
    // query runs. Observing that error here, rather than NotFoundError, is
    // direct proof that assertActorAuthorized is now routed through
    // tenantScoped() and not the bare client.
    it("an empty tenantId throws TenantContextMissingError (proves the guard, not a bare client, is wired in)", async () => {
      await expect(assertActorAuthorized("", userAId, ["procurement_user"])).rejects.toThrow(TenantContextMissingError);
    });
  });

  // ---------------------------------------------------------------
  // Regression — existing service behavior is unaffected by the guard
  // ---------------------------------------------------------------
  describe("regression: existing service-layer behavior is unaffected", () => {
    it("a full request -> sourcing -> quote path still works end-to-end through the now-guarded services", async () => {
      const line = await buildFreshRequestLine();
      const sourcingEvent = await sourcingService.createSourcingEvent(tenantAId, line.id);
      const quote = await quoteService.submitQuote({
        tenantId: tenantAId,
        sourcingEventId: sourcingEvent.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      expect(quote.versions[0].tenantId).toBe(tenantAId);
    });

    it("decisionService/approvalService still reject cross-tenant access with NotFoundError at the service boundary (R10's primary layer, unchanged)", async () => {
      const line = await buildFreshRequestLine();
      const sourcingEvent = await sourcingService.createSourcingEvent(tenantAId, line.id);
      const quote = await quoteService.submitQuote({
        tenantId: tenantAId,
        sourcingEventId: sourcingEvent.id,
        supplierId: supplierAId,
        productId: productAId,
        quotedQuantity: 10,
        unit: "EA",
        unitPrice: 10,
        currency: "EUR",
      });
      const draft = await decisionService.formDecision({
        tenantId: tenantAId,
        sourcingEventId: sourcingEvent.id,
        sourceQuoteVersionId: quote.versions[0].id,
        selectedQuantity: 5,
        createdById: userAId,
      });
      await expect(decisionService.freezeDecisionPackage(tenantBId, draft.id, userAId)).rejects.toThrow();
      await expect(approvalService.approve(tenantBId, draft.id, userAId)).rejects.toThrow();
    });
  });

  async function buildFreshRequestLine() {
    const request = await requestService.createRequest({
      tenantId: tenantAId,
      createdById: userAId,
      lines: [{ productId: productAId, requestedQuantity: 1, unit: "EA" }],
    });
    return request.lines[0];
  }
});
