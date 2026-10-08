import { tenantScoped } from "../db/client";
import { NotFoundError, ValidationError } from "../domain/errors";
import { requireId } from "../domain/validation";

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

// Correctness invariant (not an FX feature): a raw numeric comparison of
// `unitPrice` across differing `currency` values is mathematically valid
// JavaScript but a commercially false price comparison (e.g. "9 EUR < 10
// USD" means nothing without an exchange rate, which this system does not
// have and does not compute — see docs/decisions/ratified.md R6, which
// requires multi-currency *support*, not normalization). This function
// must never let such a comparison decide, or silently influence, which
// QuoteVersion it recommends.
function allSameCurrency(quotes: { currency: string }[]): boolean {
  return quotes.every((q) => q.currency === quotes[0].currency);
}

export async function generateRecommendation(tenantId: string, sourcingEventId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
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

  let sorted: typeof pool;
  let rationale: string;

  if (fullyCovering.length > 0) {
    // Primary (and only) criterion here is lowest unit price across the
    // WHOLE fully-covering pool — exactly the comparison that must never
    // cross a currency boundary. If this pool spans more than one
    // currency, there is no safe winner to pick without either comparing
    // incompatible values or inventing an FX/tie-break policy this
    // function has no ratified basis for — so it refuses, the same way
    // it already refuses when no QuoteVersions exist at all.
    if (!allSameCurrency(fullyCovering)) {
      const currencies = [...new Set(fullyCovering.map((c) => c.currency))];
      throw new ValidationError(
        `Cannot generate a price-based recommendation for SourcingEvent ${validSourcingEventId}: fully-covering ` +
          `quotes are denominated in more than one currency (${currencies.join(", ")}); unit prices across ` +
          `different currencies are not directly comparable and no currency conversion is performed by this system.`
      );
    }
    sorted = [...fullyCovering].sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice));
    rationale = "Lowest unit price among quotes that fully cover the requested quantity (deterministic test rule).";
  } else {
    // Primary criterion is highest available quantity — a plain numeric
    // comparison, always safe regardless of currency. Unit price is only
    // ever consulted as a tie-break among candidates that already share
    // the same (maximum) quantity. If that tied top group spans more
    // than one currency, the tie cannot be broken safely — refuse, for
    // the same reason as above, rather than guessing.
    const maxQuantity = Math.max(...pool.map((c) => Number(c.quotedQuantity)));
    const topQuantityGroup = pool.filter((c) => Number(c.quotedQuantity) === maxQuantity);
    if (topQuantityGroup.length > 1 && !allSameCurrency(topQuantityGroup)) {
      const currencies = [...new Set(topQuantityGroup.map((c) => c.currency))];
      throw new ValidationError(
        `Cannot generate a recommendation for SourcingEvent ${validSourcingEventId}: multiple quotes tie for the ` +
          `highest available quantity (${maxQuantity}) but are denominated in more than one currency ` +
          `(${currencies.join(", ")}); unit prices across different currencies are not directly comparable and no ` +
          `currency conversion is performed by this system.`
      );
    }
    sorted = [...pool].sort((a, b) => {
      const qtyDiff = Number(b.quotedQuantity) - Number(a.quotedQuantity);
      if (qtyDiff !== 0) return qtyDiff;
      // Defense-in-depth: even for a pair that does not decide the final
      // recommendation, never compute a price difference across
      // currencies — treated as incomparable (stable order) rather than
      // silently subtracted.
      if (a.currency !== b.currency) return 0;
      return Number(a.unitPrice) - Number(b.unitPrice);
    });
    rationale =
      "Highest available quantity, tie-broken by lowest unit price, since no quote fully covers the requested quantity (deterministic test rule).";
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
    },
    include: { recommendedQuoteVersion: true },
  });
}
