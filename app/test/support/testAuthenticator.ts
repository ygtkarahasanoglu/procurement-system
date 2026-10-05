import type { Request } from "express";
import type { Authenticator, Principal } from "../../src/api/principal";

// Test-only authenticator (AUTH-1/2/3/5/6 planning, Step 4). Resolves a
// Principal strictly from two dedicated test-only headers — it performs no
// cryptographic verification, no session/token handling, and no lookup
// against real credentials. It exists solely so HTTP-boundary tests can
// establish a known, deterministic Principal before a real identity
// provider is chosen.
//
// MUST NEVER be imported from app/src/, and must never be wired into
// server.ts's own (production/dev) composition root — it lives under
// app/test/ specifically so it is never reachable from that path.
//
// It does not bypass tenant checks: it has no tenant-matching logic of its
// own at all — it only ever reports the identity the test headers claim,
// exactly as given. Any tenant-claim verification (tenantBinding.ts) is a
// separate, not-yet-wired concern. It does not grant roles or permissions
// either: role/permission checks remain entirely in domain/authorization.ts,
// which this file never touches.
export const TEST_USER_ID_HEADER = "x-test-user-id";
export const TEST_TENANT_ID_HEADER = "x-test-tenant-id";

export const testAuthenticator: Authenticator = async (req: Request): Promise<Principal | null> => {
  const userId = req.header(TEST_USER_ID_HEADER);
  const tenantId = req.header(TEST_TENANT_ID_HEADER);
  if (!userId || !tenantId) {
    return null;
  }
  return { userId, tenantId };
};
