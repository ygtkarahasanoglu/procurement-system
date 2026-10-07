import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { SupplierResponsePage } from "./components/SupplierResponsePage.tsx";

// RFQ UI End-to-End V1 — the only path-based branch in this app, decided
// here, before either component tree is ever mounted. No routing library
// is introduced (the repo has none, and this is a single additional
// path): this mirrors the backend's own existing pattern exactly
// (server.ts mounts /rfq-responses/:token and /auth/* before its
// Principal authentication middleware, every other route after it). The
// response-link path (/rfq-response/<token>, singular) is already fixed
// by the composed email (rfqEmailComposer.ts, buildResponseUrl) — not
// chosen here. Taking this branch means <App/> (and its unconditional
// api.getMe() session bootstrap) is never mounted at all for this URL.
const SUPPLIER_RESPONSE_PATH_PREFIX = "/rfq-response/";

function resolveSupplierResponseToken(pathname: string): string | null {
  if (!pathname.startsWith(SUPPLIER_RESPONSE_PATH_PREFIX)) return null;
  const token = pathname.slice(SUPPLIER_RESPONSE_PATH_PREFIX.length);
  return token.length > 0 ? decodeURIComponent(token) : null;
}

const supplierResponseToken = resolveSupplierResponseToken(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {supplierResponseToken ? <SupplierResponsePage token={supplierResponseToken} /> : <App />}
  </StrictMode>
);
