import { prisma, tenantScoped } from "../db/client";
import { requireId } from "../domain/validation";
import { NotFoundError } from "../domain/errors";

// Read-only aggregate views for the UI. These functions perform NO
// mutation and enforce NO business rule beyond tenant scoping — every
// consequential rule (freeze boundary, Approval gate, commercial
// correspondence, authorization) lives exclusively in
// requestService/sourcingService/quoteService/recommendationService/
// decisionService/approvalService/purchaseOrderService, which this file
// never duplicates. This exists only because the UI needs to display
// state that no endpoint previously returned (list tenants/users/
// products/suppliers for the dev actor selector and forms; list
// requests; and one aggregate "workflow state" read per RequestLine so
// the UI doesn't need N round trips to render one screen).

// AUTHN-10 (docs/decisions/ratified.md): scoped exclusively to the
// authenticated principal's own tenant — never all tenants. tenantId here
// must come only from req.principal!.tenantId at the call site
// (server.ts); this function has no way to distinguish a verified
// principal's tenantId from a client-supplied one, so that verification is
// the caller's responsibility, not this function's.
// This looks up the GLOBAL Tenant model by its own id (not a tenantId
// foreign key) — Tenant carries no tenantId column (db/client.ts,
// TENANT_SCOPED_MODELS) and is outside SEC-012/R15's scope by design, so
// this one call deliberately uses the base `prisma` client rather than
// `tenantScoped()`.
export async function listTenants(tenantId: string) {
  return prisma.tenant.findMany({ where: { id: tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

// Everything a dev user needs to populate selectors/forms for one tenant.
export async function getTenantContext(tenantId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const db = tenantScoped(validTenantId);
  const [users, products, suppliers] = await Promise.all([
    db.user.findMany({ where: { tenantId: validTenantId }, orderBy: { createdAt: "asc" } }),
    db.product.findMany({ where: { tenantId: validTenantId }, orderBy: { createdAt: "asc" } }),
    db.supplier.findMany({ where: { tenantId: validTenantId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { users, products, suppliers };
}

export async function listRequests(tenantId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const db = tenantScoped(validTenantId);
  return db.procurementRequest.findMany({
    where: { tenantId: validTenantId },
    orderBy: { createdAt: "desc" },
    include: { lines: { include: { product: true } } },
  });
}

// Aggregate read of everything the workflow screen needs for one
// RequestLine: its (at most one, per RL-C3) active SourcingEvent, every
// QuoteVersion submitted against it, every RecommendationRecord
// generated, the (at most one, V1 simplification) DecisionPackage, its
// Approval if any, and the resulting PurchaseOrder if any.
export async function getRequestLineWorkflow(tenantId: string, requestLineId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRequestLineId = requireId(requestLineId, "requestLineId");
  const db = tenantScoped(validTenantId);

  const requestLine = await db.requestLine.findFirst({
    where: { id: validRequestLineId, tenantId: validTenantId },
    include: { product: true, request: true },
  });
  if (!requestLine) {
    throw new NotFoundError("RequestLine", validRequestLineId);
  }

  const sourcingEvents = await db.sourcingEvent.findMany({
    where: { requestLineId: validRequestLineId, tenantId: validTenantId },
    orderBy: { createdAt: "asc" },
  });
  // RL-C3: at most one is ever OPEN; this picks it (or the most recent,
  // if somehow none are OPEN) purely for display — it decides nothing.
  const activeSourcingEvent = sourcingEvents.find((se) => se.status === "OPEN") ?? sourcingEvents.at(-1) ?? null;

  if (!activeSourcingEvent) {
    return { requestLine, sourcingEvent: null, quoteVersions: [], recommendations: [], decisionPackages: [], rfqDispatches: [] };
  }

  const [quoteVersions, recommendations, decisionPackages, rfqDispatches] = await Promise.all([
    db.quoteVersion.findMany({
      where: { tenantId: validTenantId, supplierQuote: { sourcingEventId: activeSourcingEvent.id } },
      include: { supplierQuote: { include: { supplier: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.recommendationRecord.findMany({
      where: { tenantId: validTenantId, sourcingEventId: activeSourcingEvent.id },
      include: { recommendedQuoteVersion: { include: { supplierQuote: { include: { supplier: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.decisionPackage.findMany({
      where: { tenantId: validTenantId, sourcingEventId: activeSourcingEvent.id },
      include: {
        approvals: { include: { purchaseOrder: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // RFQ UI End-to-End V1: explicit `select` (not the default
    // all-columns `include`) so a schema change elsewhere can never
    // accidentally add responseTokenHash (or any other sensitive field)
    // to what this read-only UI aggregate returns. tokenExpiresAt is
    // deliberately omitted too — the UI has no genuine need to display
    // it, and omitting it keeps this response to the minimum the
    // internal workflow screen actually needs.
    db.rFQDispatch.findMany({
      where: { tenantId: validTenantId, sourcingEventId: activeSourcingEvent.id },
      select: {
        id: true,
        supplierId: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return { requestLine, sourcingEvent: activeSourcingEvent, quoteVersions, recommendations, decisionPackages, rfqDispatches };
}

// RFQ-EH7 (docs/decisions/ratified.md): a narrow, dedicated read path
// for RFQ Event History — deliberately separate from
// getRequestLineWorkflow above rather than folded into it, since
// forensic history is not needed on every workflow-page load the way
// the operational dispatch list already is. Reuses the exact same
// authorization boundary already proven on that function and on its
// own route (GET /request-lines/:id/workflow): authenticated,
// tenant-bound, via assertTenantMatches at the route layer — no new
// role/permission taxonomy, consistent with RFQ-EH7's own explicit
// floor.
//
// Explicit `select` (not `include`), mirroring the exact same
// discipline already used for the rfqDispatches read above — only the
// RFQ-EH2/RFQ-EH4/RFQ-EH5/RFQ-EH8 fields are ever returned; a future
// schema change to this table cannot silently widen this response.
export async function listRfqCommunicationEvents(tenantId: string, rfqDispatchId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRfqDispatchId = requireId(rfqDispatchId, "rfqDispatchId");
  const db = tenantScoped(validTenantId);

  // Existence + tenant check, same shape as every sibling lookup in
  // this file — a cross-tenant or nonexistent dispatch id is rejected
  // identically (NotFoundError), never distinguished.
  const dispatch = await db.rFQDispatch.findFirst({
    where: { id: validRfqDispatchId, tenantId: validTenantId },
    select: { id: true },
  });
  if (!dispatch) {
    throw new NotFoundError("RFQDispatch", validRfqDispatchId);
  }

  return db.rFQCommunicationEvent.findMany({
    where: { tenantId: validTenantId, rfqDispatchId: validRfqDispatchId },
    select: {
      id: true,
      eventType: true,
      occurredAt: true,
      actorSource: true,
      actorUserId: true,
      outcome: true,
      providerMessageId: true,
      quoteVersionId: true,
    },
    orderBy: { occurredAt: "asc" },
  });
}

// Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
// (docs/decisions/ratified.md). A narrow, read-only operational-
// visibility extension, mirroring listRfqCommunicationEvents immediately
// above — same authorization boundary (authenticated, tenant-bound via
// assertTenantMatches at the route layer, no new role/permission
// taxonomy), same dispatch-ownership-check-then-select-list shape. This
// reuses RFQ-EH7's already-ratified read floor; it is not a new
// semantic decision.
//
// RFQProviderDeliveryEvent is deliberately OUTSIDE db/client.ts's
// TENANT_SCOPED_MODELS guard (see that model's own schema comment:
// UNCORRELATED rows legitimately carry no tenantId) — so, unlike every
// other query in this file, the R15/SEC-012 backstop provides NO
// automatic protection here. The dispatch-ownership check below
// therefore happens FIRST, via tenantScoped() against RFQDispatch
// (which IS guarded); only once that succeeds does this function query
// RFQProviderDeliveryEvent directly (via the bare `prisma` client,
// matching providerDeliveryEventService.ts's own established
// convention for this exact model), with an explicit `tenantId` AND
// `rfqDispatchId` filter in its own `where` — never relying on the
// guard to catch a mistake.
//
// Because the `where` clause always supplies the caller's own,
// already-verified, non-null tenantId, this query can never return an
// UNCORRELATED row: such rows always have tenantId = null in the
// database, which can never equal a non-null filter value. No separate
// "exclude UNCORRELATED" check is needed — it is structurally
// impossible for one to match. This function also never looks up by
// `providerMessageId`/`sg_message_id` or any other provider identifier,
// and never searches across dispatches (RFQ-PD5).
//
// Deliberately narrow select: eventType/providerSubtype/providerEventAt
// only. `providerMessageId` is retained in the schema only as
// diagnostic metadata for manual investigation (RFQ-PD5) and is
// deliberately never returned by this ordinary operational read;
// `correlationState`, `provider`, `tenantId`, and `rfqDispatchId` are
// internal plumbing a procurement user never needs to see. No
// confidence/attribution field exists anywhere in the schema to
// accidentally select (RFQ-PD8/RFQ-ATT1).
export async function listRfqProviderDeliveryEvents(tenantId: string, rfqDispatchId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRfqDispatchId = requireId(rfqDispatchId, "rfqDispatchId");
  const db = tenantScoped(validTenantId);

  // Existence + tenant check, same shape as every sibling lookup in
  // this file — a cross-tenant or nonexistent dispatch id is rejected
  // identically (NotFoundError), never distinguished.
  const dispatch = await db.rFQDispatch.findFirst({
    where: { id: validRfqDispatchId, tenantId: validTenantId },
    select: { id: true },
  });
  if (!dispatch) {
    throw new NotFoundError("RFQDispatch", validRfqDispatchId);
  }

  return prisma.rFQProviderDeliveryEvent.findMany({
    where: { tenantId: validTenantId, rfqDispatchId: validRfqDispatchId },
    select: {
      id: true,
      eventType: true,
      providerSubtype: true,
      providerEventAt: true,
    },
    orderBy: { providerEventAt: "asc" },
  });
}
