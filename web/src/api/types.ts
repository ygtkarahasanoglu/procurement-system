// Shapes mirror the backend's Prisma models exactly (decimals arrive as
// strings over JSON, which is what the backend's /src/services return).
// This file has no logic — it exists only so the UI is typed against
// what the backend actually returns, never guesses at shape.

export interface Tenant {
  id: string;
  name: string;
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

export interface RequestLineWorkflow {
  requestLine: RequestLine & { request: ProcurementRequest };
  sourcingEvent: SourcingEvent | null;
  quoteVersions: QuoteVersion[];
  recommendations: RecommendationRecord[];
  decisionPackages: DecisionPackage[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
