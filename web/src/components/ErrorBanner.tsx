import { ApiError } from "../api/client";

// Human-readable translation of backend error "kind" names, never the
// raw message a Prisma internal or stack trace could contain (the
// backend already never sends those — see server.ts's error
// middleware — but this is a second, independent layer of defense).
const KIND_LABELS: Record<string, string> = {
  ValidationError: "Invalid input",
  NotFoundError: "Not found",
  TenantMismatchError: "Not found",
  InvalidStateError: "Invalid state for this action",
  ApprovalRequiredError: "Approval required",
  CommercialDeviationError: "Commercial deviation rejected",
  AuthorizationError: "Not authorized",
  NetworkError: "Could not reach the server",
};

export function ErrorBanner({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  if (!error) return null;
  const label = error instanceof ApiError ? KIND_LABELS[error.kind] ?? "Request failed" : "Unexpected error";
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="error-banner" role="alert">
      <strong>{label}:</strong> {message}
      <button className="error-banner__dismiss" onClick={onDismiss} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}
