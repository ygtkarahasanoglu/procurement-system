import { randomBytes, createHash } from "node:crypto";

// Pure, stateless crypto primitives for an RFQ supplier-response
// capability token — RFQ Batch 3. Deliberately mirrors session.ts's own
// generateRawToken/hashToken pattern exactly (same entropy, same
// encoding, same hash), rather than inventing a new one: this module
// has no Prisma/tenantScoped import and no business logic of any kind.
// Persistence, tenant scoping, and expiry/business-duration policy all
// live in rfqDispatchService.ts, not here.
//
// The raw token itself carries no embedded RFQDispatch/tenant/supplier
// identity — it is opaque by design. Resolving it to anything is only
// ever possible via a server-side hash lookup (a later batch's
// responsibility; this module does not implement lookup/consumption).

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy, matching session.ts

export function generateRawToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
