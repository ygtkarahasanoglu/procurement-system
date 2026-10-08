import type {
  ApiErrorBody,
  Approval,
  DecisionPackage,
  Principal,
  ProcurementRequest,
  Product,
  PurchaseOrder,
  QuoteExtraction,
  QuoteDocumentSummary,
  QuoteVersion,
  RecommendationRecord,
  RequestLineWorkflow,
  RFQDispatch,
  RfqCommunicationEvent,
  RfqProviderDeliveryEvent,
  RfqResponseContext,
  SourcingEvent,
  Supplier,
  Tenant,
  TenantContext,
} from "./types";

// The ONLY place in the frontend that talks to the backend. The UI has
// no direct database access of any kind — every action here is a plain
// HTTP call to the existing Express API (plus the four thin read-only
// endpoints added in src/services/queryService.ts). No business rule is
// implemented here; this file only shapes requests/responses.

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** Where the browser is sent to obtain a session — the backend's own
 * /auth/login (never a frontend-relative path: the API is a different
 * origin in local dev, :3000 vs the web dev server's :5173). */
export const LOGIN_URL = `${API_BASE_URL}/auth/login`;

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
      credentials: "include", // send/receive the server-side session cookie (AUTHN-4/11)
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
  /** Who the current session cookie authenticates as — null if there is
   * none/it's invalid (the backend's 401), never thrown for that case. */
  getMe: async (): Promise<Principal | null> => {
    try {
      return await get<Principal>("/auth/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  /** Revokes the current session cookie server-side (AUTHN Step 7). */
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  listTenants: () => get<Tenant[]>("/tenants"),
  getTenantContext: (tenantId: string) => get<TenantContext>(`/tenants/${tenantId}/context`),
  listRequests: (tenantId: string) => get<ProcurementRequest[]>(`/requests?tenantId=${tenantId}`),

  createProduct: (tenantId: string, name: string, sku: string) => post<Product>("/products", { tenantId, name, sku }),
  createSupplier: (tenantId: string, name: string) => post<Supplier>("/suppliers", { tenantId, name }),
  updateProduct: (tenantId: string, productId: string, name: string, sku: string) =>
    patch<Product>(`/products/${productId}`, { tenantId, name, sku }),
  updateSupplier: (tenantId: string, supplierId: string, name: string) =>
    patch<Supplier>(`/suppliers/${supplierId}`, { tenantId, name }),

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
    // AI-1 (docs/decisions/ratified.md): optional, displayed-only fields.
    leadTimeDays?: number;
    paymentTermDays?: number;
    validUntil?: string;
    incoterm?: string;
  }) => post<{ id: string; versions: QuoteVersion[] }>("/quotes", input),

  // AI-1: buyer quote-document upload + AI extraction review.
  uploadQuoteDocument: (input: { sourcingEventId: string; supplierId: string; fileName: string; mimeType: string; base64: string }) =>
    post<{ document: QuoteDocumentSummary; extraction: QuoteExtraction }>("/quote-documents", input),

  getQuoteExtractions: (tenantId: string, sourcingEventId: string) =>
    get<QuoteExtraction[]>(`/sourcing-events/${sourcingEventId}/quote-extractions?tenantId=${tenantId}`),

  confirmExtraction: (
    tenantId: string,
    extractionId: string,
    input: {
      productId: string;
      quotedQuantity: number;
      unit: string;
      unitPrice: number;
      currency: string;
      leadTimeDays?: number;
      paymentTermDays?: number;
      validUntil?: string;
      incoterm?: string;
    }
  ) => post<{ id: string; versions: QuoteVersion[] }>(`/quote-extractions/${extractionId}/confirm`, { tenantId, ...input }),

  rejectExtraction: (tenantId: string, extractionId: string) =>
    post<QuoteExtraction>(`/quote-extractions/${extractionId}/reject`, { tenantId }),

  // Not a JSON call — the direct URL for the original file (opened via
  // a plain <a href> link, never fetched through `request()` above).
  quoteDocumentFileUrl: (tenantId: string, quoteDocumentId: string) =>
    `${API_BASE_URL}/quote-documents/${quoteDocumentId}/file?tenantId=${tenantId}`,

  // AI-1 commit 4: supplier document upload via the RFQ response link —
  // Principal-free, same carve-out as submitRfqResponse below.
  uploadRfqResponseDocument: (token: string, input: { fileName: string; mimeType: string; base64: string }) =>
    post<{ document: QuoteDocumentSummary; extraction: QuoteExtraction }>(
      `/rfq-responses/${encodeURIComponent(token)}/document`,
      input
    ),

  // FX-1 (docs/decisions/ratified.md): rateType is optional on the
  // backend (defaults to "SELLING") — passed through only when the
  // caller supplies one, never invented here.
  generateRecommendation: (tenantId: string, sourcingEventId: string, rateType?: "SELLING" | "BUYING") =>
    post<RecommendationRecord>("/recommendations", { tenantId, sourcingEventId, ...(rateType ? { rateType } : {}) }),

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
    actingUserId: string,
    input: { selectedQuantity?: number; unitPrice?: number }
  ) => patch<DecisionPackage>(`/decisions/${decisionPackageId}`, { tenantId, actingUserId, ...input }),

  freezeDecision: (tenantId: string, decisionPackageId: string, actingUserId: string) =>
    post<DecisionPackage>(`/decisions/${decisionPackageId}/freeze`, { tenantId, actingUserId }),

  approve: (tenantId: string, decisionPackageId: string, approvedById: string) =>
    post<Approval>("/approvals", { tenantId, decisionPackageId, approvedById }),

  createPurchaseOrder: (tenantId: string, approvalId: string, actingUserId: string) =>
    post<PurchaseOrder>("/purchase-orders", { tenantId, approvalId, actingUserId }),

  // RFQ UI End-to-End V1. tenantId/actorUserId are never sent — both
  // routes derive them exclusively from the session-authenticated
  // Principal server-side (server.ts), exactly like /rfq-dispatches/:id/send
  // already did before this addition.
  createRFQDispatch: (sourcingEventId: string, supplierId: string) =>
    post<RFQDispatch>("/rfq-dispatches", { sourcingEventId, supplierId }),

  sendRFQDispatch: (rfqDispatchId: string) => post<{ status: string }>(`/rfq-dispatches/${rfqDispatchId}/send`, {}),

  // RFQ-RT1/RFQ-RT3: same-dispatch retry, a distinct action from
  // sendRFQDispatch above — always targets an existing dispatch id,
  // never creates a new one.
  retryRFQDispatch: (rfqDispatchId: string) => post<{ status: string }>(`/rfq-dispatches/${rfqDispatchId}/retry`, {}),

  // RFQ-EH7 (docs/decisions/ratified.md): same authenticated/tenant-bound
  // read floor as every other GET above — no new role/permission concept.
  getRfqCommunicationEvents: (tenantId: string, rfqDispatchId: string) =>
    get<RfqCommunicationEvent[]>(`/rfq-dispatches/${rfqDispatchId}/events?tenantId=${tenantId}`),

  // RFQ-PD1–RFQ-PD20: same read floor, reused per queryService's own
  // comment — not a new decision.
  getRfqProviderDeliveryEvents: (tenantId: string, rfqDispatchId: string) =>
    get<RfqProviderDeliveryEvent[]>(`/rfq-dispatches/${rfqDispatchId}/provider-events?tenantId=${tenantId}`),

  // Principal-free — the opaque token in the path is the sole
  // identifier, exactly mirroring the backend's own unauthenticated
  // carve-out (RFQ-R1-R5). Never sends/receives a session cookie's worth
  // of meaningful data; `credentials: "include"` on `request()` above is
  // harmless here since no cookie exists for a supplier's browser.
  getRfqResponseContext: (token: string) => get<RfqResponseContext>(`/rfq-responses/${encodeURIComponent(token)}`),

  submitRfqResponse: (
    token: string,
    input: { quantity: number; unit: string; unitPrice: number; currency: string }
  ) => post<{ id: string }>(`/rfq-responses/${encodeURIComponent(token)}`, input),
};
