import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client";
import * as quoteService from "../src/services/quoteService";
import * as recommendationService from "../src/services/recommendationService";
import { ValidationError } from "../src/domain/errors";

// Currency-safety correctness fix for recommendationService.ts. No FX
// conversion, no exchange-rate provider, no tenant configuration, no
// currency registry — this file proves only that generateRecommendation
// never numerically compares `unitPrice` across differing `currency`
// values (R6 requires multi-currency support, not normalization).

describe("generateRecommendation — currency safety", () => {
  let tenantId: string;
  let userId: string;
  let productId: string;
  let supplierAId: string;
  let supplierBId: string;
  let supplierCId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "RecommendationCurrency Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "RecommendationCurrency User", role: "procurement_user" } })).id;
    productId = (await prisma.product.create({ data: { tenantId, name: "RecommendationCurrency Product", sku: "RCUR-SKU" } })).id;
    supplierAId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationCurrency Supplier A" } })).id;
    supplierBId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationCurrency Supplier B" } })).id;
    supplierCId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationCurrency Supplier C" } })).id;
  });

  async function makeSourcingEvent(requestedQuantity: string) {
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: userId } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId, requestedQuantity, unit: "EA" },
    });
    return (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  }

  async function quote(sourcingEventId: string, supplierId: string, quotedQuantity: number, unitPrice: number, currency: string) {
    return quoteService.submitQuote({ tenantId, sourcingEventId, supplierId, productId, quotedQuantity, unit: "EA", unitPrice, currency });
  }

  // ---------------------------------------------------------------
  // A. Same currency — existing behavior preserved exactly.
  // ---------------------------------------------------------------
  describe("A. same-currency regression", () => {
    it("ranks correctly by unit price when all fully-covering quotes share one currency", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "EUR");
      const qB = await quote(se, supplierBId, 80, 9.5, "EUR"); // does not fully cover 100
      const qC = await quote(se, supplierCId, 110, 8, "EUR"); // fully covers, cheaper than A

      const rec = await recommendationService.generateRecommendation(tenantId, se);
      expect(rec.recommendedQuoteVersionId).toBe(qC.versions[0].id);
      void qA;
      void qB;
    });

    it("D. regression — the exact README-documented scenario (100 EA EUR10 vs 80 EA EUR9.50) is unchanged", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "EUR");
      await quote(se, supplierBId, 80, 9.5, "EUR");

      const rec = await recommendationService.generateRecommendation(tenantId, se);
      // Supplier A is the only fully-covering quote (100 >= 100); Supplier
      // B (80) does not cover and is excluded from the fully-covering pool.
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
    });

    it("non-fully-covering branch: same-currency price tie-break at the max quantity still works", async () => {
      const se = await makeSourcingEvent("1000"); // nothing fully covers
      const qA = await quote(se, supplierAId, 100, 10, "EUR");
      const qB = await quote(se, supplierBId, 100, 8, "EUR"); // same quantity, cheaper -> wins tie-break
      await quote(se, supplierCId, 50, 1, "EUR"); // lower quantity, never wins

      const rec = await recommendationService.generateRecommendation(tenantId, se);
      expect(rec.recommendedQuoteVersionId).toBe(qB.versions[0].id);
      void qA;
    });
  });

  // ---------------------------------------------------------------
  // B. Different currencies — must never be numerically compared.
  // ---------------------------------------------------------------
  describe("B. different-currency safety", () => {
    it("two otherwise-comparable fully-covering quotes in different currencies are never ordered by raw unit price", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR"); // numerically smaller, but NOT "cheaper" — must not be picked on that basis

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow(ValidationError);
    });

    it("the rejection message names both currencies and never claims a price relationship", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR");

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow(/USD.*EUR|EUR.*USD/);
    });

    it("a currency-ambiguous SourcingEvent never creates a RecommendationRecord at all", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR");

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow();
      const records = await prisma.recommendationRecord.findMany({ where: { tenantId, sourcingEventId: se } });
      expect(records.length).toBe(0);
    });

    it("non-fully-covering branch: a quantity tie across different currencies is also refused, never price-decided", async () => {
      const se = await makeSourcingEvent("1000"); // nothing fully covers
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 1, "EUR"); // same (max) quantity, numerically cheaper, different currency

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------
  // C. Mixed-currency candidate sets.
  // ---------------------------------------------------------------
  describe("C. mixed-currency candidate set", () => {
    it("underlying QuoteVersions remain fully present (never deleted) after a refused recommendation", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR");

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow();

      const versions = await quoteService.listQuoteVersionsForSourcingEvent(tenantId, se);
      expect(versions.length).toBe(2);
    });

    it("a mixed set where only ONE quote fully covers is NOT ambiguous — no currency conflict, succeeds normally", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "USD"); // the only fully-covering quote
      await quote(se, supplierBId, 50, 1, "EUR"); // does not fully cover; irrelevant currency

      const rec = await recommendationService.generateRecommendation(tenantId, se);
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
    });

    it("three currencies among fully-covering quotes: still refused, never silently resolved to one winner", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR");
      await quote(se, supplierCId, 100, 420000, "TRY");

      await expect(recommendationService.generateRecommendation(tenantId, se)).rejects.toThrow(ValidationError);
    });
  });
});
