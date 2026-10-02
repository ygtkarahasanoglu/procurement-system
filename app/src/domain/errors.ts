// Domain-level errors for the procurement vertical slice. Each error
// name is deliberately tied to the ratified rule it enforces, so a
// failing test or a caught error is traceable back to a specific
// decision in docs/decisions/ratified.md.

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

// Raised whenever an id is resolved against the wrong tenant context.
// Deliberately indistinguishable from "not found" to the caller — a
// cross-tenant lookup must never reveal that the record exists under a
// different tenant. See README "Tenant isolation" limitations.
export class TenantMismatchError extends NotFoundError {
  constructor(entity: string, id: string) {
    super(entity, id);
    this.name = "TenantMismatchError";
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

// APO-D1 / APO-D2: no valid Approval for the relevant frozen decision.
export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

// CT-A1 / CR-A / CR-B.1 / CR-B.2 / Q3: an attempt to make the
// PurchaseOrder's decision-bearing commercial content diverge from the
// approved decision it must derive from.
export class CommercialDeviationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommercialDeviationError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
