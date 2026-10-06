import { tenantScoped } from "../db/client";
import { NotFoundError } from "../domain/errors";
import { requireId } from "../domain/validation";

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
