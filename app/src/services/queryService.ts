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
    return { requestLine, sourcingEvent: null, quoteVersions: [], recommendations: [], decisionPackages: [] };
  }

  const [quoteVersions, recommendations, decisionPackages] = await Promise.all([
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
  ]);

  return { requestLine, sourcingEvent: activeSourcingEvent, quoteVersions, recommendations, decisionPackages };
}
