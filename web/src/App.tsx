import { useCallback, useEffect, useState } from "react";
import { api, LOGIN_URL } from "./api/client";
import type { Principal, ProcurementRequest, Product, Supplier, User } from "./api/types";
import { ErrorBanner } from "./components/ErrorBanner";
import { NewRequestForm } from "./components/NewRequestForm";
import { NewProductForm } from "./components/NewProductForm";
import { NewSupplierForm } from "./components/NewSupplierForm";
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

  // Always clears local identity state, even if the request itself fails
  // (network error, etc.) — a failed logout call must never leave the UI
  // showing an authenticated workspace it can no longer be sure is valid.
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setPrincipal(null);
    }
  }, []);

  return { principal, checked, logout };
}

export default function App() {
  const { principal, checked, logout } = useSessionBootstrap();

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

  return <AuthenticatedApp principal={principal} onLogout={logout} />;
}

// Tenant and acting-user identity come exclusively from the authenticated
// Principal (AUTHN) — there is no manual tenant/actor selection and no
// localStorage identity state. The backend already treats any
// frontend-supplied tenantId/createdById/actingUserId/approvedById as
// non-authoritative (tenantId is validated against req.principal via
// assertTenantMatches; the actor fields are overridden with
// req.principal!.userId outright) — this component simply sends the real
// values instead of ones from a dropdown.
function AuthenticatedApp({ principal, onLogout }: { principal: Principal; onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reloadTenantData = useCallback(() => {
    api
      .getTenantContext(principal.tenantId)
      .then((ctx) => {
        setProducts(ctx.products);
        setSuppliers(ctx.suppliers);
        setUsers(ctx.users);
      })
      .catch(setError);
    api.listRequests(principal.tenantId).then(setRequests).catch(setError);
  }, [principal.tenantId]);

  // Already-tenant-scoped data from the same context fetch above — no new
  // request. Falls back to no name (the identity bar still shows the
  // existing truncated id) if, for any reason, the signed-in user's own
  // row isn't found in it.
  const currentUserName = users.find((u) => u.id === principal.userId)?.name;

  useEffect(() => {
    reloadTenantData();
  }, [reloadTenantData]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>YGT Procurement — MVP Workspace</h1>
        <div className="identity-bar">
          <span className="identity-bar__info">
            {currentUserName && <strong>{currentUserName}</strong>}
            {currentUserName ? " · " : ""}
            {principal.userId.slice(0, 8)} · {principal.tenantId.slice(0, 8)}
          </span>
          <button type="button" className="btn btn--link" onClick={onLogout}>
            Sign out
          </button>
        </div>
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
            users={users}
            onBack={() => {
              setOpenLineId(null);
              reloadTenantData();
            }}
            onError={setError}
          />
        ) : (
          <>
            <NewProductForm
              tenantId={principal.tenantId}
              onCreated={(product) => setProducts((prev) => [...prev, product])}
              onError={setError}
            />
            <NewSupplierForm
              tenantId={principal.tenantId}
              onCreated={(supplier) => setSuppliers((prev) => [...prev, supplier])}
              onError={setError}
            />
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
