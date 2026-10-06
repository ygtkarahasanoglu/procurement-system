import { Prisma } from "@prisma/client";
import { tenantScoped } from "../db/client";
import { NotFoundError, InvalidStateError } from "../domain/errors";
import { assertActorAuthorized } from "../domain/authorization";
import { requireId } from "../domain/validation";

// M2: Approval is a historical, tenant-level, INSERT-only authorization
// fact. There is no update or delete function for Approval anywhere in
// this codebase, by design — once created, an Approval row is never
// modified.
//
// APO-D1: a PurchaseOrder may only exist after a valid Approval for the
// relevant frozen decision exists — this function is that existence
// gate's producer.
// APO-D2: Approval is the normative authorization basis for creating
// the PO — distinct from Execution Authority/Capability/transmission,
// none of which this function grants.
//
// V1 cardinality simplification (NOT a ratified decision): at most one
// Approval per DecisionPackage. The pre-check below gives a clear error
// in the common sequential case; the DB unique constraint on
// Approval.decisionPackageId is what actually protects the invariant
// under concurrent approve() calls for the same DecisionPackage — the
// resulting unique-constraint violation (Prisma code P2002) is caught
// and translated into the same InvalidStateError a caller would see
// from the pre-check, so a race and the sequential case look identical.
export async function approve(tenantId: string, decisionPackageId: string, approvedById: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validDecisionPackageId = requireId(decisionPackageId, "decisionPackageId");
  const validApprovedById = requireId(approvedById, "approvedById");

  await assertActorAuthorized(validTenantId, validApprovedById, ["approver"]);
  const db = tenantScoped(validTenantId);

  const decisionPackage = await db.decisionPackage.findFirst({
    where: { id: validDecisionPackageId, tenantId: validTenantId },
  });
  if (!decisionPackage) {
    throw new NotFoundError("DecisionPackage", validDecisionPackageId);
  }
  if (decisionPackage.status !== "FROZEN") {
    throw new InvalidStateError(
      `DecisionPackage ${validDecisionPackageId} is ${decisionPackage.status}; Approval requires a FROZEN DecisionPackage (APO-D1).`
    );
  }

  const existingApproval = await db.approval.findUnique({ where: { decisionPackageId: validDecisionPackageId } });
  if (existingApproval) {
    throw new InvalidStateError(
      `DecisionPackage ${validDecisionPackageId} already has an Approval (${existingApproval.id}) — V1 permits at most one.`
    );
  }

  try {
    return await db.approval.create({
      data: {
        tenantId: validTenantId,
        decisionPackageId: validDecisionPackageId,
        status: "APPROVED",
        approvedById: validApprovedById,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new InvalidStateError(
        `DecisionPackage ${validDecisionPackageId} already has an Approval (created concurrently) — V1 permits at most one.`
      );
    }
    throw err;
  }
}
