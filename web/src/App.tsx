import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import type { ProcurementRequest, Product, Supplier } from "./api/types";
import { TenantActorBar, type ActorSelection } from "./components/TenantActorBar";
import { ErrorBanner } from "./components/ErrorBanner";
import { NewRequestForm } from "./components/NewRequestForm";
import { RequestList } from "./components/RequestList";
import { WorkflowPage } from "./components/WorkflowPage";
import "./app.css";

const STORAGE_KEY = "procurement-ui.actor-selection";

export default function App() {
  const [selection, setSelection] = useState<ActorSelection | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ActorSelection) : null;
    } catch {
      return null;
    }
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  function handleSelectionChange(next: ActorSelection) {
    setSelection(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const reloadTenantData = useCallback(() => {
    if (!selection) return;
    api
      .getTenantContext(selection.tenantId)
      .then((ctx) => {
        setProducts(ctx.products);
        setSuppliers(ctx.suppliers);
      })
      .catch(setError);
    api.listRequests(selection.tenantId).then(setRequests).catch(setError);
  }, [selection]);

  useEffect(() => {
    reloadTenantData();
  }, [reloadTenantData]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>YGT Procurement — MVP Workspace</h1>
        <TenantActorBar selection={selection} onChange={handleSelectionChange} />
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className="app-main">
        {!selection ? (
          <p className="empty-state">Select a tenant and an actor above to begin.</p>
        ) : openLineId ? (
          <WorkflowPage
            tenantId={selection.tenantId}
            actorUserId={selection.actorUserId}
            requestLineId={openLineId}
            products={products}
            suppliers={suppliers}
            onBack={() => {
              setOpenLineId(null);
              reloadTenantData();
            }}
            onError={setError}
          />
        ) : (
          <>
            <NewRequestForm
              tenantId={selection.tenantId}
              actorUserId={selection.actorUserId}
              products={products}
              onCreated={(lineId) => setOpenLineId(lineId)}
              onError={setError}
            />
            <section className="panel">
              <h2>Requests</h2>
              <RequestList requests={requests} onOpenLine={setOpenLineId} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
