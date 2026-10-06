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

// AUTHN-5 (docs/decisions/ratified.md): application-level external-
// identity provisioning authorization. Deliberately separate from
// assertActorAuthorized above — provisioning capability
// (User.canProvisionExternalIdentities) is never checked by, and never
// implied by, a procurement-domain role, and this function never
// accepts or consults `role`/`allowedRoles` in any way. Both the acting
// User and the target User are resolved fresh, through the same
// tenant-scoped access path as every other check in this codebase —
// never from a Principal or any other value carried over from an
// earlier request. A cross-tenant target is looked up within the
// actor's own tenant scope and is therefore indistinguishable from a
// nonexistent one, matching this codebase's existing not-found
// discipline (assertActorAuthorized above; TenantMismatchError in
// domain/errors.ts). This function does not itself perform, or call,
// any provisioning write — it only authorizes the attempt; the
// existing provisionExternalIdentity script/logic remains the sole
// domain operation that creates an ExternalIdentity row, unchanged.
export async function assertProvisioningAuthorized(actorTenantId: string, actorUserId: string, targetUserId: string) {
  const db = tenantScoped(actorTenantId);

  const actor = await db.user.findFirst({ where: { id: actorUserId, tenantId: actorTenantId } });
  if (!actor) {
    // Cross-tenant / nonexistent actor — do not distinguish the two.
    throw new NotFoundError("User", actorUserId);
  }
  if (!actor.canProvisionExternalIdentities) {
    throw new AuthorizationError(`User ${actorUserId} does not have external-identity provisioning authority.`);
  }

  const target = await db.user.findFirst({ where: { id: targetUserId, tenantId: actorTenantId } });
  if (!target) {
    // Cross-tenant / nonexistent target — do not distinguish the two.
    throw new NotFoundError("User", targetUserId);
  }

  return { actor, target };
}
