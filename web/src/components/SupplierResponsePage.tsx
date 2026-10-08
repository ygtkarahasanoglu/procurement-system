import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RfqResponseContext } from "../api/types";
import { SupplierResponseForm, SupplierDocumentUpload } from "./SupplierResponseForm";

interface Props {
  token: string;
}

// RFQ UI End-to-End V1 — the Principal-free counterpart to the
// authenticated workspace (App.tsx). Deliberately does NOT call
// api.getMe(), does NOT import useSessionBootstrap, and holds no
// tenant/actor selection of any kind: the opaque token in the URL is the
// supplier's sole credential (RFQ-R1-R5, docs/decisions/ratified.md).
// main.tsx decides which of the two trees to mount before either one
// renders — this component is never reachable from inside App.tsx.
export function SupplierResponsePage({ token }: Props) {
  const [context, setContext] = useState<RfqResponseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api
      .getRfqResponseContext(token)
      // Generic, indistinguishable message for every failure cause
      // (nonexistent/expired/already-consumed token, network error,
      // unexpected 500) — mirrors the backend's own deliberate
      // non-enumeration (RFQ-R2/R3). This page has no identity/session
      // state to recover into, so there is no more specific action to
      // offer for any of them.
      .then(setContext, () => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="app">
      <main className="app-main">
        <h1>Request for Quote</h1>
        {loading && <p>Loading…</p>}
        {!loading && invalid && (
          <p className="empty-state">This request-for-quote link is invalid or has expired.</p>
        )}
        {!loading && !invalid && context && submitted && (
          <p className="empty-state">Thank you — your response has been recorded.</p>
        )}
        {!loading && !invalid && context && !submitted && (
          <section className="panel">
            <p>
              {context.productName} — {context.requestedQuantity} {context.unit} requested
            </p>
            <SupplierResponseForm token={token} onSubmitted={() => setSubmitted(true)} />
            <SupplierDocumentUpload token={token} onSubmitted={() => setSubmitted(true)} />
          </section>
        )}
      </main>
    </div>
  );
}
