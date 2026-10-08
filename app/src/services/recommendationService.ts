import { tenantScoped } from "../db/client";
import { NotFoundError, ValidationError } from "../domain/errors";
import { requireId } from "../domain/validation";
import { tcmbFxRateProvider, type FxBulletin, type FxRateProvider } from "./fxRateProvider";

// CR-C: this produces a RecommendationRecord only. It is explicitly NOT
// an approved decision, is never read by decisionService's freeze path
// as anything other than an optional starting point the human may
// override, and is never read by approvalService or
// purchaseOrderService at all.
//
// DETERMINISTIC/TEST PROVIDER — NOT A REAL AI PROVIDER.
// This is a fixed, explainable rule standing in for an eventual real
// recommendation provider (LLM-based or otherwise), so the domain
// workflow can be tested without depending on LLM quality or
// availability. It must not be presented as, or mistaken for, genuine
// external intelligence. Rule (documented, not hidden):
//   1. Prefer quote versions whose quotedQuantity >= the Request Line's
//      requestedQuantity ("full coverage").
//   2. Among full-coverage candidates, pick the lowest unitPrice.
//   3. If no candidate fully covers the requested quantity, pick the
//      candidate with the highest quotedQuantity (best available
//      coverage), breaking ties by lowest unitPrice.
// This rule is intentionally simple and is not a ratified business
// rule — it exists only to produce a reproducible non-binding
// recommendation for the V1 scenario.
const PROVIDER_NAME = "deterministic-test-provider-v1";

export type FxRateType = "SELLING" | "BUYING";

export interface GenerateRecommendationDeps {
  fxRateProvider?: FxRateProvider;
}

function allSameCurrency(quotes: { currency: string }[]): boolean {
  return quotes.every((q) => q.currency === quotes[0].currency);
}

// FX-1 (docs/decisions/ratified.md): the rate for exactly one unit of
// `currency`, expressed in TRY, from one already-fetched bulletin.
// TRY itself is always 1 (FX-1 item 4) — never looked up in the
// bulletin. Returns null whenever the bulletin has no usable rate for
// this currency/rateType pair — the caller (generateRecommendation)
// must treat that as a fail-closed condition, never a zero or a guess.
function tryRatePerUnit(bulletin: FxBulletin, currency: string, rateType: FxRateType): number | null {
  if (currency === "TRY") return 1;
  const entry = bulletin.rates[currency];
  if (!entry || entry.unit <= 0) return null;
  const published = rateType === "SELLING" ? entry.forexSelling : entry.forexBuying;
  if (published === null) return null;
  return published / entry.unit;
}

const FX_RATE_TYPE_LABEL: Record<FxRateType, string> = {
  SELLING: "Forex Selling",
  BUYING: "Forex Buying",
};

export async function generateRecommendation(
  tenantId: string,
  sourcingEventId: string,
  rateType: FxRateType = "SELLING",
  deps: GenerateRecommendationDeps = {}
) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
  if (rateType !== "SELLING" && rateType !== "BUYING") {
    throw new ValidationError(`rateType must be "SELLING" or "BUYING" (got: ${JSON.stringify(rateType)}).`);
  }
  const db = tenantScoped(validTenantId);

  const sourcingEvent = await db.sourcingEvent.findFirst({
    where: { id: validSourcingEventId, tenantId: validTenantId },
    include: { requestLine: true },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", validSourcingEventId);
  }

  const candidates = await db.quoteVersion.findMany({
    where: { tenantId: validTenantId, supplierQuote: { sourcingEventId: validSourcingEventId } },
  });
  if (candidates.length === 0) {
    throw new ValidationError(
      `No QuoteVersions exist for SourcingEvent ${validSourcingEventId}; cannot generate a recommendation.`
    );
  }

  const requestedQuantity = Number(sourcingEvent.requestLine.requestedQuantity);

  const fullyCovering = candidates.filter((c) => Number(c.quotedQuantity) >= requestedQuantity);
  const pool = fullyCovering.length > 0 ? fullyCovering : candidates;

  // FX-1: a bulletin is fetched ONLY when the pool actually being
  // compared by price spans more than one currency. A same-currency
  // pool (including an all-TRY pool) behaves exactly as before this
  // decision — no FX call, no FX fields on the created record.
  let fx: { bulletin: FxBulletin; ratesUsed: Record<string, number> } | null = null;
  if (!allSameCurrency(pool)) {
    const provider = deps.fxRateProvider ?? tcmbFxRateProvider;
    let bulletin: FxBulletin;
    try {
      bulletin = await provider.getBulletin();
    } catch (err) {
      throw new ValidationError(
        `Cannot generate a recommendation for SourcingEvent ${validSourcingEventId}: the FX-1 TCMB bulletin could ` +
          `not be fetched (${err instanceof Error ? err.message : String(err)}). No fallback source is used.`
      );
    }

    const ratesUsed: Record<string, number> = {};
    for (const currency of new Set(pool.map((c) => c.currency))) {
      const rate = tryRatePerUnit(bulletin, currency, rateType);
      if (rate === null) {
        throw new ValidationError(
          `Cannot generate a recommendation for SourcingEvent ${validSourcingEventId}: the FX-1 TCMB bulletin ` +
            `dated ${bulletin.bulletinDate} has no ${FX_RATE_TYPE_LABEL[rateType]} rate for currency "${currency}". ` +
            `No cross-currency recommendation is produced without one.`
        );
      }
      ratesUsed[currency] = rate;
    }
    fx = { bulletin, ratesUsed };
  }

  // The price actually used for comparison: the raw unitPrice when the
  // pool is single-currency, or its TRY-converted value (FX-1 item 4)
  // when it is not. Quantity is never converted — it is a count of
  // goods, not a monetary value.
  function comparablePrice(c: { unitPrice: unknown; currency: string }): number {
    if (!fx) return Number(c.unitPrice);
    return Number(c.unitPrice) * fx.ratesUsed[c.currency];
  }

  let sorted: typeof pool;
  let rationale: string;

  if (fullyCovering.length > 0) {
    sorted = [...fullyCovering].sort((a, b) => comparablePrice(a) - comparablePrice(b));
    rationale = fx
      ? `Lowest unit price among quotes that fully cover the requested quantity, compared in TRY using the TCMB ` +
        `bulletin dated ${fx.bulletin.bulletinDate} (${FX_RATE_TYPE_LABEL[rateType]}) (deterministic test rule).`
      : "Lowest unit price among quotes that fully cover the requested quantity (deterministic test rule).";
  } else {
    sorted = [...pool].sort((a, b) => {
      const qtyDiff = Number(b.quotedQuantity) - Number(a.quotedQuantity);
      if (qtyDiff !== 0) return qtyDiff;
      return comparablePrice(a) - comparablePrice(b);
    });
    rationale = fx
      ? `Highest available quantity, tie-broken by lowest unit price compared in TRY using the TCMB bulletin dated ` +
        `${fx.bulletin.bulletinDate} (${FX_RATE_TYPE_LABEL[rateType]}), since no quote fully covers the requested ` +
        `quantity (deterministic test rule).`
      : "Highest available quantity, tie-broken by lowest unit price, since no quote fully covers the requested quantity (deterministic test rule).";
  }

  const chosen = sorted[0];

  return db.recommendationRecord.create({
    data: {
      tenantId: validTenantId,
      sourcingEventId: validSourcingEventId,
      recommendedQuoteVersionId: chosen.id,
      recommendedQuantity: chosen.quotedQuantity,
      providerName: PROVIDER_NAME,
      isDeterministicTestProvider: true,
      rationale,
      fxSource: fx ? "TCMB" : null,
      fxBulletinDate: fx ? fx.bulletin.bulletinDate : null,
      fxRateType: fx ? rateType : null,
      fxRatesUsed: fx ? fx.ratesUsed : undefined,
    },
    include: { recommendedQuoteVersion: true },
  });
}
