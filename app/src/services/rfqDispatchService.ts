import { tenantScoped } from "../db/client";
import { NotFoundError } from "../domain/errors";
import { requireId } from "../domain/validation";
import { generateRawToken, hashToken } from "../api/rfqResponseToken";

// RFQ response lifetime — an IMPLEMENTATION-ONLY DEFAULT, not a ratified
// business policy. Unlike session.ts's SESSION_LIFETIME_MS (traceable to
// AUTHN-4), no equivalent decision exists in docs/decisions/ for how
// long an RFQ response window should remain open. Chosen as a plausible
// placeholder; revisit if/when a real duration requirement is ratified.
const RFQ_RESPONSE_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // ~14 days

// R1 (docs/decisions/ratified.md): RFQ = SourcingEvent + RFQDispatch x N.
// This is the prepare/create side only (SEC-014, "Prepare != Transmit")
// — creating an RFQDispatch never implies an email was sent, a supplier
// was contacted, or any other external side effect. Token generation
// (responseTokenHash/tokenExpiresAt), email dispatch, and supplier
// response capture are all separate, later batches; this function
// leaves both fields unset (null), exactly as the PENDING-only schema
// default already does.
//
// No role-based authorization gate is applied here, deliberately
// mirroring sourcingService.createSourcingEvent and
// quoteService.submitQuote: domain/authorization.ts's own comment
// states assertActorAuthorized is applied only to freezing a
// DecisionPackage, creating an Approval, and creating a PurchaseOrder —
// "Request/quote creation are not gated here in V1." An RFQDispatch
// sits in that same ungated tier (it is the prepare step preceding any
// consequential/approval-like action), so this follows the existing
// convention rather than inventing a new one.
//
// RFQ resend policy is OPEN (docs/decisions/open.md) — this function
// deliberately does not check for, or reject, an existing RFQDispatch
// for the same (sourcingEventId, supplierId) pair. Multiple dispatches
// for the same pair are allowed, exactly as Batch 1's schema (no
// uniqueness constraint there) already permits.
export async function createRFQDispatch(tenantId: string, sourcingEventId: string, supplierId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
  const validSupplierId = requireId(supplierId, "supplierId");
  const db = tenantScoped(validTenantId);

  // Existence + tenant check only — the same shape as every sibling
  // check in this codebase (sourcingService.createSourcingEvent,
  // quoteService.submitQuote), and deliberately not a new SourcingEvent
  // lifecycle rule: no sibling service conditions a write on
  // SourcingEvent.status, so this function does not either. A
  // cross-tenant or nonexistent id is rejected identically
  // (NotFoundError), never distinguished.
  const sourcingEvent = await db.sourcingEvent.findFirst({
    where: { id: validSourcingEventId, tenantId: validTenantId },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", validSourcingEventId);
  }

  const supplier = await db.supplier.findFirst({
    where: { id: validSupplierId, tenantId: validTenantId },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier", validSupplierId);
  }

  return db.rFQDispatch.create({
    data: { tenantId: validTenantId, sourcingEventId: validSourcingEventId, supplierId: validSupplierId },
  });
}

// Generates and persists a fresh supplier-response capability token for
// an existing RFQDispatch. Prepare/create (Batch 2) and token issuance
// (this function) are deliberately separate: nothing in this codebase
// calls this yet — it is not wired to RFQDispatch creation, and not
// wired to any SEND step (which does not exist yet either). See the
// RFQ Batch 3 assessment for why issuance belongs immediately before a
// future SEND, not at PENDING creation.
//
// The raw token is generated and hashed via rfqResponseToken.ts (pure
// crypto, no DB access of its own) and returned to the caller exactly
// once; only its SHA-256 hash is ever persisted, mirroring session.ts's
// own createSession discipline. The atomic conditional update
// (updateMany with tenantId in `where`, count === 0 -> NotFoundError)
// mirrors productService.updateProduct/supplierService.updateSupplier
// exactly — a cross-tenant or nonexistent rfqDispatchId is rejected
// identically to a nonexistent one, never distinguished.
//
// Calling this a second time for the same RFQDispatch simply rotates
// the token: a fresh raw token/hash is generated and overwrites the
// previous one, so the previous raw token's hash no longer matches
// anything persisted. This is ONLY a token-rotation mechanic — it does
// not decide, imply, or encode RFQ resend policy, single-use response
// policy, or quote revision policy, all of which remain OPEN
// (docs/decisions/open.md) and are not touched by this function.
export async function issueResponseToken(tenantId: string, rfqDispatchId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRfqDispatchId = requireId(rfqDispatchId, "rfqDispatchId");
  const db = tenantScoped(validTenantId);

  const rawToken = generateRawToken();
  const responseTokenHash = hashToken(rawToken);
  const tokenExpiresAt = new Date(Date.now() + RFQ_RESPONSE_TOKEN_LIFETIME_MS);

  const result = await db.rFQDispatch.updateMany({
    where: { id: validRfqDispatchId, tenantId: validTenantId },
    data: { responseTokenHash, tokenExpiresAt },
  });
  if (result.count === 0) {
    throw new NotFoundError("RFQDispatch", validRfqDispatchId);
  }

  return { rawToken, tokenExpiresAt };
}
