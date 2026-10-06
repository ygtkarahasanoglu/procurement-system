import { tenantScoped } from "../db/client";
import { NotFoundError } from "./errors";

// Minimum server-side authorization boundary for V1. This is
// deliberately simple (a per-tenant role string on User, checked against
// an allow-list per operation) and is NOT the production RBAC/policy
// system U3 anticipates — see README "Authorization" limitations for
// exactly what this does and does not guarantee.
//
// Applied only to the three operations section 15 of the implementation
// brief names explicitly: freezing a DecisionPackage, creating an
// Approval, and creating a PurchaseOrder. Request/quote creation are not
// gated here in V1 — see README.
export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function assertActorAuthorized(tenantId: string, userId: string, allowedRoles: string[]) {
  const db = tenantScoped(tenantId);
  const user = await db.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) {
    // Cross-tenant / nonexistent actor — do not distinguish the two.
    throw new NotFoundError("User", userId);
  }
  if (!allowedRoles.includes(user.role)) {
    throw new AuthorizationError(
      `User ${userId} (role=${user.role}) is not authorized for this operation; requires one of: ${allowedRoles.join(", ")}.`
    );
  }
  return user;
}
