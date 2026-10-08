import { beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";
import * as quoteService from "../src/services/quoteService";
import * as recommendationService from "../src/services/recommendationService";
import { ValidationError } from "../src/domain/errors";
import { createApp } from "../src/api/server";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";
import { FakeFxRateProvider, unreachableFxRateProvider } from "./support/fakeFxRateProvider";
import type { FxBulletin } from "../src/services/fxRateProvider";

// FX-1 (docs/decisions/ratified.md): currency-safety + TCMB conversion
// correctness for generateRecommendation. No test here ever calls the
// real TCMB endpoint — every mixed-currency case injects FakeFxRateProvider
// (same double-injection pattern as FakeEmailSender), and every
// same-currency case injects unreachableFxRateProvider to prove the FX
// path is never entered at all.

// Wide buy/sell spread on USD, narrow on EUR, so SELLING and BUYING can
// pick genuinely different winners — proving rateType actually matters,
// not just that conversion happens.
const BULLETIN: FxBulletin = {
  bulletinDate: "08.10.2026",
  rates: {
    USD: { unit: 1, forexBuying: 30, forexSelling: 40 },
    EUR: { unit: 1, forexBuying: 35, forexSelling: 35.5 },
    JPY: { unit: 100, forexBuying: 22, forexSelling: 23 },
  },
};

describe("generateRecommendation — FX-1 currency conversion", () => {
  let tenantId: string;
  let userId: string;
  let productId: string;
  let supplierAId: string;
  let supplierBId: string;
  let supplierCId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "RecommendationFx Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "RecommendationFx User", role: "procurement_user" } })).id;
    productId = (await prisma.product.create({ data: { tenantId, name: "RecommendationFx Product", sku: "RFX-SKU" } })).id;
    supplierAId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationFx Supplier A" } })).id;
    supplierBId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationFx Supplier B" } })).id;
    supplierCId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationFx Supplier C" } })).id;
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
  // Same-currency regression — unaffected by FX-1, no FX call made.
  // ---------------------------------------------------------------
  describe("same-currency path is unchanged and makes no FX call", () => {
    it("ranks correctly by unit price when all fully-covering quotes share one currency", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "EUR");
      await quote(se, supplierBId, 80, 9.5, "EUR"); // does not fully cover 100
      const qC = await quote(se, supplierCId, 110, 8, "EUR"); // fully covers, cheaper than A

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", {
        fxRateProvider: unreachableFxRateProvider,
      });
      expect(rec.recommendedQuoteVersionId).toBe(qC.versions[0].id);
      expect(rec.fxSource).toBeNull();
      expect(rec.fxBulletinDate).toBeNull();
      expect(rec.fxRateType).toBeNull();
      expect(rec.fxRatesUsed).toBeNull();
    });

    it("the exact README-documented scenario (100 EA EUR10 vs 80 EA EUR9.50) is unchanged", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "EUR");
      await quote(se, supplierBId, 80, 9.5, "EUR");

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", {
        fxRateProvider: unreachableFxRateProvider,
      });
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
    });

    it("non-fully-covering branch: same-currency price tie-break at the max quantity still works, no FX call", async () => {
      const se = await makeSourcingEvent("1000"); // nothing fully covers
      await quote(se, supplierAId, 100, 10, "EUR");
      const qB = await quote(se, supplierBId, 100, 8, "EUR"); // same quantity, cheaper -> wins tie-break
      await quote(se, supplierCId, 50, 1, "EUR");

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", {
        fxRateProvider: unreachableFxRateProvider,
      });
      expect(rec.recommendedQuoteVersionId).toBe(qB.versions[0].id);
    });

    it("an all-TRY pool is treated as same-currency too — no FX call for TRY-only comparisons", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 300, "TRY");
      await quote(se, supplierBId, 100, 400, "TRY");

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", {
        fxRateProvider: unreachableFxRateProvider,
      });
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
      expect(rec.fxSource).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Mixed currency — converted to TRY via one bulletin, never a raw
  // cross-currency numeric comparison.
  // ---------------------------------------------------------------
  describe("mixed currency — TCMB conversion", () => {
    it("picks the correct winner with SELLING", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "USD"); // 10 * 40 (selling) = 400 TRY
      const qB = await quote(se, supplierBId, 100, 9, "EUR"); // 9 * 35.5 (selling) = 319.5 TRY -> cheaper

      const provider = new FakeFxRateProvider();
      provider.setBulletin(BULLETIN);

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", { fxRateProvider: provider });
      expect(rec.recommendedQuoteVersionId).toBe(qB.versions[0].id);
      expect(rec.fxSource).toBe("TCMB");
      expect(rec.fxBulletinDate).toBe("08.10.2026");
      expect(rec.fxRateType).toBe("SELLING");
      expect(rec.fxRatesUsed).toEqual({ USD: 40, EUR: 35.5 });
      expect(rec.rationale).toContain("TRY");
      expect(rec.rationale).toContain("08.10.2026");
    });

    it("the SAME quotes with BUYING pick a DIFFERENT winner — proves rateType is actually applied, not ignored", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "USD"); // 10 * 30 (buying) = 300 TRY -> cheaper
      await quote(se, supplierBId, 100, 9, "EUR"); // 9 * 35 (buying) = 315 TRY

      const provider = new FakeFxRateProvider();
      provider.setBulletin(BULLETIN);

      const rec = await recommendationService.generateRecommendation(tenantId, se, "BUYING", { fxRateProvider: provider });
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
      expect(rec.fxRateType).toBe("BUYING");
      expect(rec.fxRatesUsed).toEqual({ USD: 30, EUR: 35 });
    });

    it("JPY's Unit=100 is correctly divided out before comparison", async () => {
      const se = await makeSourcingEvent("100");
      // 2300 JPY/unit, Unit=100, selling=23 -> rate-per-unit = 23/100 = 0.23 -> 2300 * 0.23 = 529 TRY.
      const qJpy = await quote(se, supplierAId, 100, 2300, "JPY");
      await quote(se, supplierBId, 100, 600, "TRY"); // more expensive than the correctly-converted JPY price

      const provider = new FakeFxRateProvider();
      provider.setBulletin(BULLETIN);

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", { fxRateProvider: provider });
      expect(rec.recommendedQuoteVersionId).toBe(qJpy.versions[0].id);
      expect(rec.fxRatesUsed).toEqual({ JPY: 0.23, TRY: 1 });
    });

    it("a currency missing from the bulletin is refused, never silently skipped or guessed", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "GBP"); // not present in BULLETIN

      const provider = new FakeFxRateProvider();
      provider.setBulletin(BULLETIN);

      await expect(recommendationService.generateRecommendation(tenantId, se, "SELLING", { fxRateProvider: provider })).rejects.toThrow(
        ValidationError
      );
    });

    it("a bulletin fetch failure is refused, never falls back to a cached or guessed rate", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "EUR");

      const provider = new FakeFxRateProvider();
      provider.setError(new Error("network unreachable"));

      await expect(recommendationService.generateRecommendation(tenantId, se, "SELLING", { fxRateProvider: provider })).rejects.toThrow(
        ValidationError
      );
      const records = await prisma.recommendationRecord.findMany({ where: { tenantId, sourcingEventId: se } });
      expect(records.length).toBe(0);
    });

    it("underlying QuoteVersions remain fully present (never deleted) after a refused mixed-currency recommendation", async () => {
      const se = await makeSourcingEvent("100");
      await quote(se, supplierAId, 100, 10, "USD");
      await quote(se, supplierBId, 100, 9, "GBP");

      const provider = new FakeFxRateProvider();
      provider.setBulletin(BULLETIN);

      await expect(recommendationService.generateRecommendation(tenantId, se, "SELLING", { fxRateProvider: provider })).rejects.toThrow();
      const versions = await quoteService.listQuoteVersionsForSourcingEvent(tenantId, se);
      expect(versions.length).toBe(2);
    });

    it("a mixed set where only ONE quote fully covers makes no FX call at all (no real currency conflict)", async () => {
      const se = await makeSourcingEvent("100");
      const qA = await quote(se, supplierAId, 100, 10, "USD"); // the only fully-covering quote
      await quote(se, supplierBId, 50, 1, "EUR"); // does not fully cover; irrelevant currency

      const rec = await recommendationService.generateRecommendation(tenantId, se, "SELLING", {
        fxRateProvider: unreachableFxRateProvider,
      });
      expect(rec.recommendedQuoteVersionId).toBe(qA.versions[0].id);
      expect(rec.fxSource).toBeNull();
    });
  });
});

// ---------------------------------------------------------------
// HTTP: invalid rateType is rejected with 400, before any FX call —
// safe to exercise over real HTTP without injecting a fake provider,
// since the check happens before generateRecommendation ever reaches
// the FX path.
// ---------------------------------------------------------------
describe("POST /recommendations — FX-1 rateType validation (HTTP)", () => {
  let httpServer: Server;
  let baseUrl: string;
  let tenantId: string;
  let userId: string;
  let productId: string;
  let supplierId: string;
  let sourcingEventId: string;

  function authHeaders(uid: string, tid: string): Record<string, string> {
    return { [TEST_USER_ID_HEADER]: uid, [TEST_TENANT_ID_HEADER]: tid };
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

    const tenant = await prisma.tenant.create({ data: { name: "RecommendationFx HTTP Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "RecommendationFx HTTP User", role: "procurement_user" } })).id;
    productId = (await prisma.product.create({ data: { tenantId, name: "RecommendationFx HTTP Product", sku: "RFXH-SKU" } })).id;
    supplierId = (await prisma.supplier.create({ data: { tenantId, name: "RecommendationFx HTTP Supplier" } })).id;

    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: userId } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId, requestedQuantity: "100", unit: "EA" },
    });
    sourcingEventId = (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
    await quoteService.submitQuote({ tenantId, sourcingEventId, supplierId, productId, quotedQuantity: 100, unit: "EA", unitPrice: 10, currency: "EUR" });
  });

  it("rejects an invalid rateType with 400, never attempting FX or creating a record", async () => {
    const res = await fetch(`${baseUrl}/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(userId, tenantId) },
      body: JSON.stringify({ tenantId, sourcingEventId, rateType: "MIDPOINT" }),
    });
    expect(res.status).toBe(400);
    const records = await prisma.recommendationRecord.findMany({ where: { tenantId, sourcingEventId } });
    expect(records.length).toBe(0);
  });

  it("an omitted rateType defaults to SELLING and succeeds for a same-currency quote", async () => {
    const res = await fetch(`${baseUrl}/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(userId, tenantId) },
      body: JSON.stringify({ tenantId, sourcingEventId }),
    });
    expect(res.status).toBe(200);
  });
});
