import { prisma } from "../db/client";
import { NotFoundError, InvalidStateError, ValidationError } from "../domain/errors";
import { assertActorAuthorized } from "../domain/authorization";
import { requireId, requirePositiveDecimal } from "../domain/validation";

// CR-C: Stage 1 (Decision Formation) ends here, at freeze. Everything in
// this file before freeze is pre-Approval human revision of proposed
// commercial content — explicitly NOT a PurchaseOrder transformation,
// per CR-C's own text. The AI RecommendationRecord is never read here;
// the caller passes whatever sourceQuoteVersionId/selectedQuantity it
// has decided on (which may or may not match any recommendation).
//
// QS-C1: Selected Quantity is the quantity the decision-maker chooses to
// pursue — a distinct concept from Quoted Quantity. It need not equal
// the quote's quantity.
//
// V1 engineering constraint (not a ratified rule): selectedQuantity must
// be > 0 and <= the source QuoteVersion's quotedQuantity. Selecting more
// than what was quoted is not a scenario this slice needs to support,
// and allowing it would require a separate, unratified business rule.

export interface FormDecisionInput {
  tenantId: string;
  sourcingEventId: string;
  sourceQuoteVersionId: string;
  selectedQuantity: string | number;
  unitPrice?: string | number; // defaults to the quote's unitPrice if omitted
  createdById: string;
}

export async function formDecision(input: FormDecisionInput) {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }

  const tenantId = requireId(input.tenantId, "tenantId");
  const sourcingEventId = requireId(input.sourcingEventId, "sourcingEventId");
  const sourceQuoteVersionId = requireId(input.sourceQuoteVersionId, "sourceQuoteVersionId");
  const createdById = requireId(input.createdById, "createdById");
  const selectedQuantity = requirePositiveDecimal(input.selectedQuantity, "selectedQuantity");
  const unitPriceOverride = input.unitPrice !== undefined ? requirePositiveDecimal(input.unitPrice, "unitPrice") : undefined;

  const createdBy = await prisma.user.findFirst({ where: { id: createdById, tenantId } });
  if (!createdBy) {
    throw new NotFoundError("User", createdById);
  }

  const quoteVersion = await prisma.quoteVersion.findFirst({
    where: { id: sourceQuoteVersionId, tenantId },
    include: { supplierQuote: true },
  });
  if (!quoteVersion) {
    throw new NotFoundError("QuoteVersion", sourceQuoteVersionId);
  }
  if (quoteVersion.supplierQuote.sourcingEventId !== sourcingEventId) {
    throw new ValidationError("sourceQuoteVersionId does not belong to the given sourcingEventId.");
  }

  if (Number(selectedQuantity) > Number(quoteVersion.quotedQuantity)) {
    throw new ValidationError(
      `selectedQuantity (${selectedQuantity}) cannot exceed the source quote's quotedQuantity (${quoteVersion.quotedQuantity}).`
    );
  }

  const unitPrice = unitPriceOverride ?? quoteVersion.unitPrice.toString();

  return prisma.decisionPackage.create({
    data: {
      tenantId,
      sourcingEventId,
      sourceQuoteVersionId,
      supplierId: quoteVersion.supplierQuote.supplierId,
      productId: quoteVersion.productId,
      selectedQuantity,
      unit: quoteVersion.unit,
      unitPrice,
      currency: quoteVersion.currency,
      status: "DRAFT",
      createdById,
    },
  });
}

// Pre-freeze revision only (CR-C Stage 1). Rejects once FROZEN.
//
// Unlike formDecision/freezeDecisionPackage/approve/createPurchaseOrderFromApproval,
// this function previously accepted no actor identity at all and performed no
// actor/tenant-membership check — a real implementation defect (every other
// mutating operation in this codebase at minimum verifies the acting user
// exists within the claimed tenant). actingUserId is now required and is
// checked with the same bare existence-in-tenant pattern formDecision already
// uses above (not the role-gated assertActorAuthorized pattern used by
// freeze/approve/PO creation — revision, like formDecision, is not role-gated
// in V1; see README "Authorization" limitations).
export interface ReviseDecisionInput {
  tenantId: string;
  decisionPackageId: string;
  actingUserId: string;
  selectedQuantity?: string | number;
  unitPrice?: string | number;
}

export async function reviseDecision(input: ReviseDecisionInput) {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }
  const tenantId = requireId(input.tenantId, "tenantId");
  const decisionPackageId = requireId(input.decisionPackageId, "decisionPackageId");
  const actingUserId = requireId(input.actingUserId, "actingUserId");

  const actingUser = await prisma.user.findFirst({ where: { id: actingUserId, tenantId } });
  if (!actingUser) {
    throw new NotFoundError("User", actingUserId);
  }

  const existing = await prisma.decisionPackage.findFirst({
    where: { id: decisionPackageId, tenantId },
    include: { sourceQuoteVersion: true },
  });
  if (!existing) {
    throw new NotFoundError("DecisionPackage", decisionPackageId);
  }
  if (existing.status !== "DRAFT") {
    throw new InvalidStateError(
      `DecisionPackage ${decisionPackageId} is ${existing.status}; only a DRAFT DecisionPackage may be revised (CR-C / freeze boundary).`
    );
  }

  const data: { selectedQuantity?: string; unitPrice?: string } = {};
  if (input.selectedQuantity !== undefined) {
    const qty = requirePositiveDecimal(input.selectedQuantity, "selectedQuantity");
    if (Number(qty) > Number(existing.sourceQuoteVersion.quotedQuantity)) {
      throw new ValidationError(
        `selectedQuantity (${qty}) cannot exceed the source quote's quotedQuantity (${existing.sourceQuoteVersion.quotedQuantity}).`
      );
    }
    data.selectedQuantity = qty;
  }
  if (input.unitPrice !== undefined) {
    data.unitPrice = requirePositiveDecimal(input.unitPrice, "unitPrice");
  }

  // Re-assert DRAFT atomically: a concurrent freeze between the read
  // above and this write must not be silently overwritten by a revision.
  const result = await prisma.decisionPackage.updateMany({
    where: { id: decisionPackageId, tenantId, status: "DRAFT" },
    data,
  });
  if (result.count === 0) {
    throw new InvalidStateError(
      `DecisionPackage ${decisionPackageId} was frozen concurrently; revision rejected (CR-C / freeze boundary).`
    );
  }

  return prisma.decisionPackage.findUniqueOrThrow({ where: { id: decisionPackageId } });
}

// One-way DRAFT -> FROZEN transition. After this, no function in this
// service (or anywhere else in the codebase) mutates the decision's
// commercial fields.
//
// The transition itself is an atomic conditional update
// (`updateMany({ where: { status: "DRAFT" } })`), not a check-then-write
// — so of two concurrent freeze attempts on the same DecisionPackage,
// exactly one succeeds and the other reliably observes
// `InvalidStateError`, rather than both reading "not yet frozen" and
// both appearing to succeed.
export async function freezeDecisionPackage(tenantId: string, decisionPackageId: string, actingUserId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validDecisionPackageId = requireId(decisionPackageId, "decisionPackageId");
  const validActingUserId = requireId(actingUserId, "actingUserId");

  await assertActorAuthorized(validTenantId, validActingUserId, ["procurement_user", "approver"]);

  const existing = await prisma.decisionPackage.findFirst({
    where: { id: validDecisionPackageId, tenantId: validTenantId },
  });
  if (!existing) {
    throw new NotFoundError("DecisionPackage", validDecisionPackageId);
  }

  const result = await prisma.decisionPackage.updateMany({
    where: { id: validDecisionPackageId, tenantId: validTenantId, status: "DRAFT" },
    data: { status: "FROZEN", frozenAt: new Date() },
  });
  if (result.count === 0) {
    throw new InvalidStateError(`DecisionPackage ${validDecisionPackageId} is already FROZEN.`);
  }

  return prisma.decisionPackage.findUniqueOrThrow({ where: { id: validDecisionPackageId } });
}
