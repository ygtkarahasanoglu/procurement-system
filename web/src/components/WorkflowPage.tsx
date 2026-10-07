import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Product, RequestLineWorkflow, Supplier, User } from "../api/types";
import { StatusStepper } from "./StatusStepper";
import { QuoteForm } from "./QuoteForm";

interface Props {
  tenantId: string;
  actorUserId: string;
  requestLineId: string;
  products: Product[];
  suppliers: Supplier[];
  users: User[];
  onBack: () => void;
  onError: (err: unknown) => void;
}

function nameOf(list: { id: string; name: string }[], id: string) {
  return list.find((x) => x.id === id)?.name ?? id.slice(0, 8);
}

// The single coherent workflow screen (brief section 4: "a single
// coherent workflow page is acceptable"). Every section below maps
// directly onto one backend call; this component holds NO business
// rule itself — it only decides which action button to show based on
// data the backend already returned (section 13: "UI state is for
// usability only").
export function WorkflowPage({ tenantId, actorUserId, requestLineId, products, suppliers, users, onBack, onError }: Props) {
  const [data, setData] = useState<RequestLineWorkflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedQuoteVersionId, setSelectedQuoteVersionId] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("");
  const [rfqSupplierId, setRfqSupplierId] = useState("");

  const reload = useCallback(() => {
    api.getWorkflow(tenantId, requestLineId).then(setData).catch(onError);
  }, [tenantId, requestLineId, onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!data) return <p>Loading…</p>;

  const { requestLine, sourcingEvent, quoteVersions, recommendations, decisionPackages, rfqDispatches } = data;
  const latestRecommendation = recommendations[0] ?? null;
  const currentDecision = decisionPackages[0] ?? null;
  const currentApproval = currentDecision?.approvals[0] ?? null;
  const currentPo = currentApproval?.purchaseOrder ?? null;

  let currentStep = 1;
  if (sourcingEvent) currentStep = 2;
  if (quoteVersions.length > 0) currentStep = 3;
  if (latestRecommendation) currentStep = 4;
  if (currentDecision) currentStep = 5;
  if (currentDecision?.status === "FROZEN") currentStep = 6;
  if (currentApproval) currentStep = 7;
  if (currentPo) currentStep = 8;

  async function runAction<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workflow-page">
      <button className="btn btn--link" onClick={onBack}>
        ← Back to requests
      </button>
      <h2>
        {requestLine.product.name} — {requestLine.requestedQuantity} {requestLine.unit} requested
      </h2>
      <StatusStepper currentStep={currentStep} />

      {/* 1. Sourcing Event */}
      <section className="panel">
        <h3>Sourcing Event</h3>
        {sourcingEvent ? (
          <p>
            Sourcing event <span className="mono">{sourcingEvent.id.slice(0, 8)}</span> is{" "}
            <strong>{sourcingEvent.status}</strong>.
          </p>
        ) : (
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={() => runAction(() => api.createSourcingEvent(tenantId, requestLineId))}
          >
            Open Sourcing Event
          </button>
        )}
      </section>

      {/* RFQ UI End-to-End V1: electronic RFQ dispatch, parallel to the
          manual quote entry below — this section holds no business
          rule itself, same discipline as every other section here. */}
      {sourcingEvent && (
        <section className="panel">
          <h3>Request for Quote (RFQ)</h3>
          {rfqDispatches.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Responded</th>
                </tr>
              </thead>
              <tbody>
                {rfqDispatches.map((d) => (
                  <tr key={d.id}>
                    <td>{d.supplier.name}</td>
                    <td>
                      <span className="badge">{d.status}</span>
                    </td>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td>{d.respondedAt ? new Date(d.respondedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="decision-form rfq-send-form">
            <select value={rfqSupplierId} onChange={(e) => setRfqSupplierId(e.target.value)}>
              <option value="">Supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !rfqSupplierId}
              onClick={() =>
                runAction(async () => {
                  const dispatch = await api.createRFQDispatch(sourcingEvent.id, rfqSupplierId);
                  await api.sendRFQDispatch(dispatch.id);
                  setRfqSupplierId("");
                })
              }
            >
              Send RFQ
            </button>
          </div>
          <p className="panel-hint">
            No real email provider is configured yet (provider selection remains an open decision) — SEND_FAILED is
            expected until one is selected. This does not block the manual quote entry below.
          </p>
        </section>
      )}

      {/* 2. Quotes */}
      {sourcingEvent && (
        <section className="panel">
          <h3>Supplier Quotes</h3>
          {quoteVersions.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Unit Price</th>
                  <th>Currency</th>
                </tr>
              </thead>
              <tbody>
                {quoteVersions.map((q) => (
                  <tr key={q.id}>
                    <td>{q.supplierQuote.supplier.name}</td>
                    <td>{q.quotedQuantity}</td>
                    <td>{q.unit}</td>
                    <td>{q.unitPrice}</td>
                    <td>{q.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <QuoteForm
            suppliers={suppliers}
            onSubmit={(input) =>
              runAction(() => api.submitQuote({ tenantId, sourcingEventId: sourcingEvent.id, productId: requestLine.productId, ...input }))
            }
          />
        </section>
      )}

      {/* 3. AI Recommendation */}
      {sourcingEvent && quoteVersions.length > 0 && (
        <section className="panel">
          <h3>AI Recommendation</h3>
          <p className="panel-hint">
            Deterministic test provider ({latestRecommendation?.providerName ?? "not yet run"}) — never the approved
            decision, only a non-binding starting point for the human decision below.
          </p>
          {latestRecommendation ? (
            <div className="value-card value-card--recommendation">
              <div>
                <strong>{latestRecommendation.recommendedQuoteVersion.supplierQuote.supplier.name}</strong>
              </div>
              <div>
                {latestRecommendation.recommendedQuantity} {latestRecommendation.recommendedQuoteVersion.unit} ×{" "}
                {latestRecommendation.recommendedQuoteVersion.unitPrice} {latestRecommendation.recommendedQuoteVersion.currency}
              </div>
              <div className="value-card__rationale">{latestRecommendation.rationale}</div>
            </div>
          ) : (
            <p className="empty-state">No recommendation generated yet.</p>
          )}
          <button
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => runAction(() => api.generateRecommendation(tenantId, sourcingEvent.id))}
          >
            Generate Recommendation
          </button>
        </section>
      )}

      {/* 4. Human Decision Formation */}
      {sourcingEvent && quoteVersions.length > 0 && (
        <section className="panel">
          <h3>Human Decision Formation</h3>
          {currentDecision ? (
            <div className={`value-card ${currentDecision.status === "FROZEN" ? "value-card--frozen" : "value-card--draft"}`}>
              <div>
                <strong>{nameOf(suppliers, currentDecision.supplierId)}</strong>{" "}
                <span className="badge">{currentDecision.status}</span>
              </div>
              <div>
                {currentDecision.selectedQuantity} {currentDecision.unit} × {currentDecision.unitPrice}{" "}
                {currentDecision.currency}
              </div>
              <div className="panel-hint">Formed by {nameOf(users, currentDecision.createdById)}</div>
              {currentDecision.status === "DRAFT" && (
                <form
                  className="decision-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const qty = Number(selectedQuantity || currentDecision.selectedQuantity);
                    runAction(() => api.reviseDecision(tenantId, currentDecision.id, actorUserId, { selectedQuantity: qty }));
                  }}
                >
                  <label>Revise selected quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={currentDecision.selectedQuantity}
                    value={selectedQuantity}
                    onChange={(e) => setSelectedQuantity(e.target.value)}
                  />
                  <button type="submit" className="btn btn--secondary" disabled={busy}>
                    Revise
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => runAction(() => api.freezeDecision(tenantId, currentDecision.id, actorUserId))}
                  >
                    Freeze Decision
                  </button>
                </form>
              )}
            </div>
          ) : (
            <form
              className="decision-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedQuoteVersionId) return;
                const qv = quoteVersions.find((q) => q.id === selectedQuoteVersionId);
                const qty = Number(selectedQuantity || qv?.quotedQuantity || 0);
                runAction(() =>
                  api.formDecision({
                    tenantId,
                    sourcingEventId: sourcingEvent.id,
                    sourceQuoteVersionId: selectedQuoteVersionId,
                    selectedQuantity: qty,
                    createdById: actorUserId,
                  })
                );
              }}
            >
              <label>Base decision on quote from</label>
              <select
                value={selectedQuoteVersionId}
                onChange={(e) => {
                  setSelectedQuoteVersionId(e.target.value);
                  const qv = quoteVersions.find((q) => q.id === e.target.value);
                  setSelectedQuantity(qv?.quotedQuantity ?? "");
                }}
              >
                <option value="">Select quote…</option>
                {quoteVersions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.supplierQuote.supplier.name} — {q.quotedQuantity} {q.unit} × {q.unitPrice} {q.currency}
                  </option>
                ))}
              </select>
              <label>Selected quantity (may differ from the quote/recommendation — this is the human decision)</label>
              <input type="number" min="0" step="any" value={selectedQuantity} onChange={(e) => setSelectedQuantity(e.target.value)} />
              <button type="submit" className="btn btn--primary" disabled={busy || !selectedQuoteVersionId}>
                Form Decision
              </button>
            </form>
          )}
        </section>
      )}

      {/* 5. Approval */}
      {currentDecision?.status === "FROZEN" && (
        <section className="panel">
          <h3>Approval</h3>
          <div className="value-card value-card--frozen">
            <div>Frozen decision:</div>
            <div>
              <strong>{nameOf(suppliers, currentDecision.supplierId)}</strong> — {currentDecision.selectedQuantity}{" "}
              {currentDecision.unit} × {currentDecision.unitPrice} {currentDecision.currency}
            </div>
          </div>
          {currentApproval ? (
            <p>
              <span className="badge badge--approved">APPROVED</span> by{" "}
              <strong>{nameOf(users, currentApproval.approvedById)}</strong> — Approval{" "}
              <span className="mono">{currentApproval.id.slice(0, 8)}</span> authorizes DecisionPackage{" "}
              <span className="mono">{currentApproval.decisionPackageId.slice(0, 8)}</span>.
            </p>
          ) : (
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => runAction(() => api.approve(tenantId, currentDecision.id, actorUserId))}
            >
              Approve
            </button>
          )}
        </section>
      )}

      {/* 6. Purchase Order */}
      {currentApproval && (
        <section className="panel">
          <h3>Purchase Order</h3>
          {currentPo ? (
            <div className="value-card value-card--po">
              <div className="panel-hint">Derived entirely from the approved decision — no commercial field was entered here.</div>
              <div>
                <strong>{nameOf(suppliers, currentPo.supplierId)}</strong>
              </div>
              <div>
                {nameOf(products, currentPo.productId)} — {currentPo.quantity} {currentPo.unit} × {currentPo.unitPrice}{" "}
                {currentPo.currency}
              </div>
            </div>
          ) : (
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => runAction(() => api.createPurchaseOrder(tenantId, currentApproval.id, actorUserId))}
            >
              Create Purchase Order
            </button>
          )}
        </section>
      )}
    </div>
  );
}
