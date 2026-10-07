// Shapes mirror the backend's Prisma models exactly (decimals arrive as
// strings over JSON, which is what the backend's /src/services return).
// This file has no logic — it exists only so the UI is typed against
// what the backend actually returns, never guesses at shape.

export interface Tenant {
  id: string;
  name: string;
}

/** Mirrors the backend's Principal exactly (app/src/api/principal.ts) —
 * returned by GET /auth/me. Never extend this beyond {userId, tenantId}
 * without a corresponding ratified backend change (AUTHN-6). */
export interface Principal {
  userId: string;
  tenantId: string;
}

export interface User {
  id: string;
  tenantId: string;
  name: string;
  role: string;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
}

export interface TenantContext {
  users: User[];
  products: Product[];
  suppliers: Supplier[];
}

export interface RequestLine {
  id: string;
  tenantId: string;
  requestId: string;
  productId: string;
  product: Product;
  requestedQuantity: string;
  unit: string;
}

export interface ProcurementRequest {
  id: string;
  tenantId: string;
  createdById: string;
  status: string;
  createdAt: string;
  lines: RequestLine[];
}

export interface SourcingEvent {
  id: string;
  tenantId: string;
  requestLineId: string;
  status: string;
  createdAt: string;
}

export interface QuoteVersion {
  id: string;
  tenantId: string;
  supplierQuoteId: string;
  versionNumber: number;
  productId: string;
  quotedQuantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  createdAt: string;
  supplierQuote: {
    id: string;
    supplierId: string;
    supplier: Supplier;
  };
}

export interface RecommendationRecord {
  id: string;
  tenantId: string;
  sourcingEventId: string;
  recommendedQuoteVersionId: string;
  recommendedQuantity: string;
  providerName: string;
  isDeterministicTestProvider: boolean;
  rationale: string;
  createdAt: string;
  recommendedQuoteVersion: QuoteVersion;
}

export interface Approval {
  id: string;
  tenantId: string;
  decisionPackageId: string;
  status: string;
  approvedById: string;
  createdAt: string;
  purchaseOrder: PurchaseOrder | null;
}

export interface DecisionPackage {
  id: string;
  tenantId: string;
  sourcingEventId: string;
  sourceQuoteVersionId: string;
  supplierId: string;
  productId: string;
  selectedQuantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  status: "DRAFT" | "FROZEN";
  frozenAt: string | null;
  createdById: string;
  createdAt: string;
  approvals: Approval[];
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  approvalId: string;
  supplierId: string;
  productId: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  createdAt: string;
}

/** Display-only fields — responseTokenHash/tokenExpiresAt are never
 * returned by the backend for this shape (queryService.getRequestLineWorkflow). */
export interface RFQDispatch {
  id: string;
  supplierId: string;
  supplier: { id: string; name: string };
  status: string;
  createdAt: string;
  respondedAt: string | null;
}

/** RFQ-EH2/RFQ-EH7 (docs/decisions/ratified.md) — returned by
 * GET /rfq-dispatches/:id/events, exactly the fields
 * queryService.listRfqCommunicationEvents selects. The closed, canonical
 * event vocabulary — never any other eventType/outcome/actorSource. */
export interface RfqCommunicationEvent {
  id: string;
  eventType: "DISPATCH_CREATED" | "SEND_ATTEMPT_RESULT" | "SUPPLIER_RESPONSE_RECEIVED";
  occurredAt: string;
  actorSource: "INTERNAL_USER" | "SYSTEM" | "SUPPLIER" | "PROVIDER";
  actorUserId: string | null;
  outcome: "ACCEPTED" | "FAILED" | "UNKNOWN" | null;
  providerMessageId: string | null;
  quoteVersionId: string | null;
}

/** RFQ-PD1–RFQ-PD20 (docs/decisions/ratified.md) — returned by
 * GET /rfq-dispatches/:id/provider-events, exactly the fields
 * queryService.listRfqProviderDeliveryEvents selects. Provider
 * mail-transport evidence ONLY — never supplier receipt, reading,
 * acceptance, agreement, identity, or representative authority
 * (RFQ-PD20/RFQ-ATT1). Deliberately omits providerMessageId,
 * correlationState, tenantId, and rfqDispatchId — see the backend
 * function's own comment for why. No confidence/attribution field
 * exists here, by design (RFQ-PD8/RFQ-ATT1) — never add one. */
export interface RfqProviderDeliveryEvent {
  id: string;
  eventType: "PROCESSED" | "DEFERRED" | "DELIVERED" | "BOUNCE" | "DROPPED";
  providerSubtype: string | null;
  providerEventAt: string;
}

export interface RequestLineWorkflow {
  requestLine: RequestLine & { request: ProcurementRequest };
  sourcingEvent: SourcingEvent | null;
  quoteVersions: QuoteVersion[];
  recommendations: RecommendationRecord[];
  decisionPackages: DecisionPackage[];
  rfqDispatches: RFQDispatch[];
}

/** Returned by GET /rfq-responses/:token — exactly what a supplier needs
 * to see before submitting, never tenantId/supplierId/sourcingEventId. */
export interface RfqResponseContext {
  productName: string;
  requestedQuantity: string;
  unit: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
