import type { Principal } from "./principal";
import { TenantMismatchError } from "../domain/errors";

// API-layer tenant-binding seam (AUTH-1/AUTH-2 planning, Step 2). Verifies
// that a tenantId claimed by a request matches the authenticated Principal's
// own tenantId, before that tenantId is trusted for anything downstream.
// This is deliberately a plain, inline-called helper (matching the existing
// requireId/requirePositiveDecimal style in domain/validation.ts) rather
// than Express middleware, since the claimed tenantId's location varies by
// route (body, query, or :id path param) and a single generic middleware
// cannot express that without per-route special-casing anyway.
//
// Reuses the existing TenantMismatchError (domain/errors.ts) rather than
// introducing a new error type: it already extends NotFoundError and is
// documented there as "deliberately indistinguishable from 'not found' to
// the caller" for exactly this cross-tenant-mismatch case, and the existing
// error-handling middleware in server.ts already maps any NotFoundError
// (TenantMismatchError included, as a subclass) to a 404 response with no
// further change required there.
//
// Not wired into server.ts or any route yet — this step only establishes
// the helper itself.
export function assertTenantMatches(principal: Principal, claimedTenantId: string): string {
  if (principal.tenantId !== claimedTenantId) {
    throw new TenantMismatchError("Tenant", claimedTenantId);
  }

  return principal.tenantId;
}
