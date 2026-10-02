import type {
  ApiErrorBody,
  Approval,
  DecisionPackage,
  ProcurementRequest,
  PurchaseOrder,
  QuoteVersion,
  RecommendationRecord,
  RequestLineWorkflow,
  SourcingEvent,
  Tenant,
  TenantContext,
} from "./types";

// The ONLY place in the frontend that talks to the backend. The UI has
// no direct database access of any kind — every action here is a plain
// HTTP call to the existing Express API (plus the four thin read-only
// endpoints added in src/services/queryService.ts). No business rule is
// implemented here; this file only shapes requests/responses.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  readonly kind: string;
  readonly status: number;
  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.kind = body.error;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError({ error: "NetworkError", message: "Could not reach the backend API." }, 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body
  }

  if (!res.ok) {
    const errBody = (body as ApiErrorBody) ?? { error: "UnknownError", message: `Request failed (${res.status}).` };
    throw new ApiError(errBody, res.status);
  }
  return body as T;
}

function post<T>(path: string, data: unknown) {
  return request<T>(path, { method: "POST", body: JSON.stringify(data) });
}
function patch<T>(path: string, data: unknown) {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(data) });
}
function get<T>(path: string) {
  return request<T>(path, { method: "GET" });
}

export const api = {
  listTenants: () => get<Tenant[]>("/tenants"),
  getTenantContext: (tenantId: string) => get<TenantContext>(`/tenants/${tenantId}/context`),
  listRequests: (tenantId: string) => get<ProcurementRequest[]>(`/requests?tenantId=${tenantId}`),

  createRequest: (input: {
    tenantId: string;
    createdById: string;
    lines: { productId: string; requestedQuantity: number; unit: string }[];
  }) => post<ProcurementRequest>("/requests", input),

  getWorkflow: (tenantId: string, requestLineId: string) =>
    get<RequestLineWorkflow>(`/request-lines/${requestLineId}/workflow?tenantId=${tenantId}`),

  createSourcingEvent: (tenantId: string, requestLineId: string) =>
    post<SourcingEvent>("/sourcing-events", { tenantId, requestLineId }),

  submitQuote: (input: {
    tenantId: string;
    sourcingEventId: string;
    supplierId: string;
    productId: string;
    quotedQuantity: number;
    unit: string;
    unitPrice: number;
    currency: string;
  }) => post<{ id: string; versions: QuoteVersion[] }>("/quotes", input),

  generateRecommendation: (tenantId: string, sourcingEventId: string) =>
    post<RecommendationRecord>("/recommendations", { tenantId, sourcingEventId }),

  formDecision: (input: {
    tenantId: string;
    sourcingEventId: string;
    sourceQuoteVersionId: string;
    selectedQuantity: number;
    createdById: string;
  }) => post<DecisionPackage>("/decisions", input),

  reviseDecision: (
    tenantId: string,
    decisionPackageId: string,
    input: { selectedQuantity?: number; unitPrice?: number }
  ) => patch<DecisionPackage>(`/decisions/${decisionPackageId}`, { tenantId, ...input }),

  freezeDecision: (tenantId: string, decisionPackageId: string, actingUserId: string) =>
    post<DecisionPackage>(`/decisions/${decisionPackageId}/freeze`, { tenantId, actingUserId }),

  approve: (tenantId: string, decisionPackageId: string, approvedById: string) =>
    post<Approval>("/approvals", { tenantId, decisionPackageId, approvedById }),

  createPurchaseOrder: (tenantId: string, approvalId: string, actingUserId: string) =>
    post<PurchaseOrder>("/purchase-orders", { tenantId, approvalId, actingUserId }),
};
