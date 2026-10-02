import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { NotFoundError, InvalidStateError, ApprovalRequiredError, CommercialDeviationError } from "../domain/errors";
import { assertActorAuthorized } from "../domain/authorization";
import { requireId, requirePositiveDecimal } from "../domain/validation";

// CR-A / CR-B.1 / CR-B.2 / CR-D1 / CR-D2 / Q3 / APO-D1 / APO-D2.
//
// There is deliberately no function that accepts PO commercial fields
// (supplier, product, quantity, unit, unitPrice, currency) as free-form
// caller input. The only entry point is this one, keyed by an Approval
// id — every commercial field is read from that Approval's frozen
// DecisionPackage and copied verbatim. This is the structural
// enforcement of CR-A's provenance requirement: there is no code path
// by which a PO's commercial content can originate anywhere else. In
// particular, supplier/product/unit/currency can NEVER be overridden by
// a caller, even in the test-only hook below — only quantity/unitPrice
// are exposed there, because those are the two fields the brief's
// adversarial scenarios exercise (Test Group 4).
//
// `testOnlyDeviationAttempt` exists ONLY to let tests prove the
// invariant above is enforced (see Test 8 in app/test). It is not part
// of any real call path and must never be wired to user input in a real
// API — it deliberately simulates "what if a caller tried to override
// the approved decision's content", which no legitimate caller can do
// because createPurchaseOrderFromApproval takes no commercial fields at
// all under normal use. src/api/server.ts's /purchase-orders route never
// reads or forwards this parameter.
export interface TestOnlyDeviationAttempt {
  quantity?: string | number;
  unitPrice?: string | number;
}

export async function createPurchaseOrderFromApproval(
  tenantId: string,
  approvalId: string,
  actingUserId: string,
  testOnlyDeviationAttempt?: TestOnlyDeviationAttempt
) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validApprovalId = requireId(approvalId, "approvalId");
  const validActingUserId = requireId(actingUserId, "actingUserId");

  // Validate shape up front (outside the transaction) so a malformed
  // test-only override produces a clean ValidationError rather than a
  // raw decimal-parsing exception surfacing from inside the transaction.
  let deviationQuantity: string | undefined;
  let deviationUnitPrice: string | undefined;
  if (testOnlyDeviationAttempt) {
    if (testOnlyDeviationAttempt.quantity !== undefined) {
      deviationQuantity = requirePositiveDecimal(testOnlyDeviationAttempt.quantity, "testOnlyDeviationAttempt.quantity");
    }
    if (testOnlyDeviationAttempt.unitPrice !== undefined) {
      deviationUnitPrice = requirePositiveDecimal(testOnlyDeviationAttempt.unitPrice, "testOnlyDeviationAttempt.unitPrice");
    }
  }

  await assertActorAuthorized(validTenantId, validActingUserId, ["procurement_user", "approver"]);

  try {
    return await prisma.$transaction(async (tx) => {
      // APO-D1: PO existence requires a valid Approval for the relevant
      // frozen decision. Scoping by (id, tenantId) together means a valid
      // Approval belonging to a different tenant is indistinguishable
      // from no Approval at all.
      const approval = await tx.approval.findFirst({
        where: { id: validApprovalId, tenantId: validTenantId },
        include: { decisionPackage: true },
      });
      if (!approval) {
        throw new ApprovalRequiredError(
          `No valid Approval ${validApprovalId} found for tenant ${validTenantId}; a PurchaseOrder cannot be created (APO-D1).`
        );
      }

      const decisionPackage = approval.decisionPackage;
      if (decisionPackage.tenantId !== validTenantId) {
        // Defense in depth; findFirst above already scopes by tenantId via
        // the Approval, so this should be unreachable.
        throw new NotFoundError("DecisionPackage", decisionPackage.id);
      }
      if (decisionPackage.status !== "FROZEN") {
        throw new InvalidStateError(
          `DecisionPackage ${decisionPackage.id} is ${decisionPackage.status}, not FROZEN; APO-D1 requires a valid Approval for a frozen decision.`
        );
      }

      const existingPo = await tx.purchaseOrder.findUnique({ where: { approvalId: validApprovalId } });
      if (existingPo) {
        throw new InvalidStateError(`Approval ${validApprovalId} already has a PurchaseOrder (${existingPo.id}).`);
      }

      // CT-A1 / CR-A / CR-B.2 / Q3: the PO's decision-bearing commercial
      // content must be EXACT correspondence (economic quantity, for
      // quantity) with the approved decision. This slice has no quantity
      // conversion (Q3-CV is not exercised — see README), so "exact
      // correspondence" here is exact numeric equality on the same unit.
      if (deviationQuantity !== undefined && new Prisma.Decimal(deviationQuantity).comparedTo(decisionPackage.selectedQuantity) !== 0) {
        throw new CommercialDeviationError(
          `Requested PO quantity (${deviationQuantity}) does not match the approved decision's quantity ` +
            `(${decisionPackage.selectedQuantity}). A PurchaseOrder may not contain decision-bearing commercial content ` +
            `whose commercial meaning differs from the approved decision authorized by the same Approval (CT-A1). If a ` +
            `different quantity is genuinely needed, CT-A2 requires it to become its own approved decision with its own Approval.`
        );
      }
      if (deviationUnitPrice !== undefined && new Prisma.Decimal(deviationUnitPrice).comparedTo(decisionPackage.unitPrice) !== 0) {
        throw new CommercialDeviationError(
          `Requested PO unitPrice (${deviationUnitPrice}) does not match the approved decision's ` +
            `unitPrice (${decisionPackage.unitPrice}) — CT-A1.`
        );
      }

      // Final guard against two concurrent calls for the same Approval
      // both passing the existingPo check above (a real TOCTOU window
      // under Prisma's default READ COMMITTED isolation): the unique
      // constraint on PurchaseOrder.approvalId is the actual protection,
      // and a resulting P2002 is translated below into the same
      // InvalidStateError the sequential case above already throws.
      return await tx.purchaseOrder.create({
        data: {
          tenantId: validTenantId,
          approvalId: validApprovalId,
          supplierId: decisionPackage.supplierId,
          productId: decisionPackage.productId,
          quantity: decisionPackage.selectedQuantity,
          unit: decisionPackage.unit,
          unitPrice: decisionPackage.unitPrice,
          currency: decisionPackage.currency,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new InvalidStateError(`Approval ${validApprovalId} already has a PurchaseOrder (created concurrently).`);
    }
    throw err;
  }
}
