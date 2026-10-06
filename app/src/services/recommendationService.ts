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

  const sorted = [...pool].sort((a, b) => {
    if (fullyCovering.length > 0) {
      return Number(a.unitPrice) - Number(b.unitPrice);
    }
    const qtyDiff = Number(b.quotedQuantity) - Number(a.quotedQuantity);
    if (qtyDiff !== 0) return qtyDiff;
    return Number(a.unitPrice) - Number(b.unitPrice);
  });

  const chosen = sorted[0];

  return db.recommendationRecord.create({
    data: {
      tenantId: validTenantId,
      sourcingEventId: validSourcingEventId,
      recommendedQuoteVersionId: chosen.id,
      recommendedQuantity: chosen.quotedQuantity,
      providerName: PROVIDER_NAME,
      isDeterministicTestProvider: true,
      rationale:
        fullyCovering.length > 0
          ? "Lowest unit price among quotes that fully cover the requested quantity (deterministic test rule)."
          : "Highest available quantity, tie-broken by lowest unit price, since no quote fully covers the requested quantity (deterministic test rule).",
    },
    include: { recommendedQuoteVersion: true },
  });
}
