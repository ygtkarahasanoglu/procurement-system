import { useCallback, useEffect, useState } from "react";
import { api, LOGIN_URL } from "./api/client";
import type { Principal, ProcurementRequest, Product, Supplier } from "./api/types";
import { ErrorBanner } from "./components/ErrorBanner";
import { NewRequestForm } from "./components/NewRequestForm";
import { RequestList } from "./components/RequestList";
import { WorkflowPage } from "./components/WorkflowPage";
import "./app.css";

// Auth bootstrap (AUTHN, post Step-11): the backend requires a session
// cookie for every route except /auth/*, so the app must know whether one
// exists before rendering anything that calls the API. `principal` is read
// once on mount and is the app's sole identity source — there is no manual
// tenant/actor selection anymore (see AuthenticatedApp below).
function useSessionBootstrap() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then(setPrincipal)
      .finally(() => setChecked(true));
  }, []);

  return { principal, checked };
}

export default function App() {
  const { principal, checked } = useSessionBootstrap();

  if (!checked) {
    return null;
  }

  if (!principal) {
    return (
      <div className="app">
        <main className="app-main">
          <p className="empty-state">
            Sign in to use the procurement workspace.{" "}
            <a href={LOGIN_URL}>Sign in</a>
          </p>
        </main>
      </div>
    );
  }

  return <AuthenticatedApp principal={principal} />;
}

// Tenant and acting-user identity come exclusively from the authenticated
// Principal (AUTHN) — there is no manual tenant/actor selection and no
// localStorage identity state. The backend already treats any
// frontend-supplied tenantId/createdById/actingUserId/approvedById as
// non-authoritative (tenantId is validated against req.principal via
// assertTenantMatches; the actor fields are overridden with
// req.principal!.userId outright) — this component simply sends the real
// values instead of ones from a dropdown.
function AuthenticatedApp({ principal }: { principal: Principal }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reloadTenantData = useCallback(() => {
    api
      .getTenantContext(principal.tenantId)
      .then((ctx) => {
        setProducts(ctx.products);
        setSuppliers(ctx.suppliers);
      })
      .catch(setError);
    api.listRequests(principal.tenantId).then(setRequests).catch(setError);
  }, [principal.tenantId]);

  useEffect(() => {
    reloadTenantData();
  }, [reloadTenantData]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>YGT Procurement — MVP Workspace</h1>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className="app-main">
        {openLineId ? (
          <WorkflowPage
            tenantId={principal.tenantId}
            actorUserId={principal.userId}
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
              tenantId={principal.tenantId}
              actorUserId={principal.userId}
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
