import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as requestService from "../services/requestService";
import * as sourcingService from "../services/sourcingService";
import * as quoteService from "../services/quoteService";
import * as recommendationService from "../services/recommendationService";
import * as decisionService from "../services/decisionService";
import * as approvalService from "../services/approvalService";
import * as purchaseOrderService from "../services/purchaseOrderService";
import * as queryService from "../services/queryService";
import * as productService from "../services/productService";
import * as supplierService from "../services/supplierService";
import { Prisma } from "@prisma/client";
import { AuthorizationError } from "../domain/authorization";
import { NotFoundError, InvalidStateError, ApprovalRequiredError, CommercialDeviationError, ValidationError } from "../domain/errors";
import type { Authenticator, Principal } from "./principal";
import { assertTenantMatches } from "./tenantBinding";
import { createAuthRouter } from "./authRoutes";
import { sessionAuthenticator } from "./sessionAuthenticator";

// AUTHN-11 (CORS Restriction Requirement, docs/decisions/ratified.md):
// reads a comma-separated allow-list of exact trusted browser origins from
// CORS_TRUSTED_ORIGINS. Deliberately fails closed on anything not an exact
// match — an unset/empty variable yields an empty list, which allows no
// cross-origin browser request at all (never a wildcard fallback). No
// production origin is hardcoded or guessed here; the local-development
// value lives only in .env/.env.example as actual configuration.
function parseCorsTrustedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// API layer for the backend, consumed by the web UI under app/web (a
// separate Vite dev server/origin — hence `cors()` below) and still
// usable directly via curl/HTTP for manual exercise. There is NO
// authentication middleware here — tenantId/actingUserId are read
// directly from the request body/query. See README "Authorization" /
// "Tenant isolation" limitations: this is sufficient to prove the
// domain/service-layer invariants are enforced independent of the API
// layer, but is not a production authentication boundary. The UI never
// bypasses this layer — it has no direct Prisma/PostgreSQL access.
//
// createApp requires an Authenticator (AUTH-1/2/3/5/6 planning, Step 3).
// This is a dependency-injection seam only: the authenticator is stored on
// app.locals for a future authentication middleware (Step 4+) to read and
// invoke — it is NOT invoked here, no middleware reads it yet, and no route
// below is authentication-protected. The module-level composition root
// below supplies a temporary placeholder (never invoked, always resolves to
// null) solely so this required parameter can be satisfied before a real
// Authenticator is chosen in a later step — see the comment there.
export function createApp(authenticator: Authenticator) {
  const app = express();
  app.locals.authenticator = authenticator;

  // AUTHN-11: exact trusted-origin allow-list, not the previous wildcard
  // default. credentials: true is required for the server-side session
  // cookie (AUTHN-4) to be usable cross-origin at all. A request with no
  // Origin header (curl, server-to-server, same-origin) is always let
  // through unchanged — CORS is a browser-enforced mechanism only and
  // must not become a second authentication/authorization gate; the
  // existing session-cookie authentication middleware below remains the
  // sole security boundary regardless of this outcome. A disallowed
  // Origin receives no Access-Control-Allow-Origin (and, by the `cors`
  // package's own callback semantics, no other CORS response header
  // either) — it is never reflected and never satisfied by a wildcard.
  const trustedOrigins = parseCorsTrustedOrigins(process.env.CORS_TRUSTED_ORIGINS);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (trustedOrigins.includes(origin)) return callback(null, origin);
        return callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json());
  // Malformed JSON ("entity.parse.failed" from body-parser) would
  // otherwise fall through to the generic 500 handler below; surface it
  // as a client error instead. Also normalize a missing/empty body to {}
  // so every service's `req.body.<field>` access sees an object rather
  // than throwing a raw TypeError before any service-level validation runs.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.parse.failed") {
      return res.status(400).json({ error: "ValidationError", message: "Request body is not valid JSON." });
    }
    next(err);
  });
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body === undefined || req.body === null) {
      req.body = {};
    }
    next();
  });

  // AUTHN Step 6A: the OIDC login/callback bootstrap routes (GET /auth/login,
  // GET /auth/callback) are mounted here, BEFORE the authentication
  // middleware below. This is deliberate and load-bearing: a browser with
  // no session yet must be able to reach these two routes to ever obtain
  // one. This is the only unauthenticated carve-out introduced by this
  // step — exactly the two routes createAuthRouter() itself defines, never
  // a broader bypass. Every other route, registered after the middleware
  // below (unchanged), remains exactly as protected as before.
  app.use("/auth", createAuthRouter());

  // Authentication boundary (AUTH-1/2/3/5/6 planning, Step 4). Invokes the
  // injected Authenticator (read from app.locals, per the Step 3 seam)
  // once per request; a null result is rejected as unauthenticated before
  // any route handler runs. This protects every route registered below
  // uniformly — no individual route is modified in this step. Tenant-claim
  // verification (tenantBinding.ts) and replacing body-supplied identity
  // fields (tenantId/actingUserId/approvedById/createdById) with
  // req.principal are both explicitly deferred to a later step; this
  // middleware establishes ONLY that a request carries a known Principal
  // at all. An authenticator that throws is treated as an unanticipated
  // failure (forwarded to the existing generic error handler below, which
  // already sanitizes it), not silently treated as a 401 rejection.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const authenticator = req.app.locals.authenticator as Authenticator;
    let principal: Principal | null;
    try {
      principal = await authenticator(req);
    } catch (err) {
      return next(err);
    }
    if (!principal) {
      return res.status(401).json({ error: "Unauthenticated", message: "Authentication is required." });
    }
    req.principal = principal;
    next();
  });

  function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await fn(req, res);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    };
  }

  // AUTHN Step 8: minimal authenticated-identity reflection endpoint.
  // Returns exactly the existing Principal{userId, tenantId} already
  // established by the authentication middleware above — no OIDC claims,
  // email, role, session metadata, or any other field is read or
  // returned (AUTHN-6). Deliberately mounted here, after the
  // authentication middleware, rather than inside authRoutes.ts's /auth
  // carve-out (mounted before it) — an unauthenticated request must get
  // the existing 401, not a bypass. req.principal is derived exclusively
  // from the session cookie via sessionAuthenticator; no query/body/header
  // field supplied by the client is ever consulted.
  app.get(
    "/auth/me",
    wrap(async (req) => ({ userId: req.principal!.userId, tenantId: req.principal!.tenantId }))
  );

  // Read-only views for the UI (section 19: reuse existing endpoints
  // wherever possible; these are the minimum new reads the UI genuinely
  // needs and none of them perform or duplicate any business rule — see
  // queryService.ts).
  //
  // AUTH-5: every route below that receives tenant context now resolves it
  // through assertTenantMatches(req.principal!, claimedTenantId) rather
  // than trusting the body/query/path value outright — a mismatch throws
  // the existing TenantMismatchError (-> 404, via the existing error
  // middleware, unchanged). req.principal is guaranteed set here: the
  // Step 4 authentication middleware above already rejected with 401 any
  // request that lacks one, before this route table is ever reached.
  // AUTHN-10 (Step 6B): scoped exclusively to req.principal!.tenantId —
  // this endpoint takes no external tenant claim (no path/query/body/header
  // tenant identifier is read for this route), so there is nothing to
  // validate against the principal; the principal's own tenantId is simply
  // the sole input. assertTenantMatches is deliberately not used here — it
  // exists to validate an externally claimed tenantId against the
  // principal, and this route has no such claim to validate.
  app.get("/tenants", wrap((req) => queryService.listTenants(req.principal!.tenantId)));
  app.get(
    "/tenants/:id/context",
    wrap((req) => queryService.getTenantContext(assertTenantMatches(req.principal!, req.params.id)))
  );
  app.get(
    "/requests",
    wrap((req) => queryService.listRequests(assertTenantMatches(req.principal!, req.query.tenantId as string)))
  );
  app.get(
    "/request-lines/:id/workflow",
    wrap((req) =>
      queryService.getRequestLineWorkflow(assertTenantMatches(req.principal!, req.query.tenantId as string), req.params.id)
    )
  );

  // Tenant-scoped reference-data creation. Exposes creation of the
  // existing flat Product/Supplier records only — no identity/master-data
  // subsystem (PI-C1-PI-C11, R3 remain untouched). tenantId is verified
  // against the authenticated principal, exactly as every other mutating
  // route below; name/sku are the only caller-controlled fields.
  app.post(
    "/products",
    wrap((req) =>
      productService.createProduct(assertTenantMatches(req.principal!, req.body.tenantId), req.body.name, req.body.sku)
    )
  );
  app.post(
    "/suppliers",
    wrap((req) =>
      supplierService.createSupplier(assertTenantMatches(req.principal!, req.body.tenantId), req.body.name)
    )
  );

  // Corrects ordinary data-entry mistakes on an already-existing
  // Product/Supplier. Same tenant-binding/authenticated-Principal
  // convention as every other mutating route above — no deletion, no
  // identity/matching semantics, no new authorization concept.
  app.patch(
    "/products/:id",
    wrap((req) =>
      productService.updateProduct(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.params.id,
        req.body.name,
        req.body.sku
      )
    )
  );
  app.patch(
    "/suppliers/:id",
    wrap((req) =>
      supplierService.updateSupplier(assertTenantMatches(req.principal!, req.body.tenantId), req.params.id, req.body.name)
    )
  );

  // AUTH-5: createdById is no longer accepted from the body as the source
  // of truth — it is overridden with the authenticated principal's userId.
  // tenantId is verified, not merely trusted. requestService.createRequest's
  // signature is unchanged; only the values this route passes to it change.
  app.post(
    "/requests",
    wrap((req) =>
      requestService.createRequest({
        ...req.body,
        tenantId: assertTenantMatches(req.principal!, req.body.tenantId),
        createdById: req.principal!.userId,
      })
    )
  );

  // No actor identity field exists for this route in V1 (by design, per
  // README "Authorization" limitations) — only tenant binding applies here.
  app.post(
    "/sourcing-events",
    wrap((req) =>
      sourcingService.createSourcingEvent(assertTenantMatches(req.principal!, req.body.tenantId), req.body.requestLineId)
    )
  );

  // Same as /sourcing-events: no actor field in V1, tenant binding only.
  app.post(
    "/quotes",
    wrap((req) =>
      quoteService.submitQuote({
        ...req.body,
        tenantId: assertTenantMatches(req.principal!, req.body.tenantId),
      })
    )
  );

  app.get(
    "/sourcing-events/:id/quote-versions",
    wrap((req) =>
      quoteService.listQuoteVersionsForSourcingEvent(
        assertTenantMatches(req.principal!, req.query.tenantId as string),
        req.params.id
      )
    )
  );

  // RecommendationRecord has no actor column (R/O deterministic-test
  // provider) — tenant binding only.
  app.post(
    "/recommendations",
    wrap((req) =>
      recommendationService.generateRecommendation(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.body.sourcingEventId
      )
    )
  );

  // AUTH-5: createdById is overridden with the authenticated principal's
  // userId, exactly as for POST /requests above.
  app.post(
    "/decisions",
    wrap((req) =>
      decisionService.formDecision({
        ...req.body,
        tenantId: assertTenantMatches(req.principal!, req.body.tenantId),
        createdById: req.principal!.userId,
      })
    )
  );

  // AUTH-5: actingUserId (added in the AUTH-4 defect fix) is now overridden
  // with the authenticated principal's userId rather than trusted from the
  // body — decisionService.reviseDecision's signature is unchanged.
  app.patch(
    "/decisions/:id",
    wrap((req) =>
      decisionService.reviseDecision({
        ...req.body,
        decisionPackageId: req.params.id,
        tenantId: assertTenantMatches(req.principal!, req.body.tenantId),
        actingUserId: req.principal!.userId,
      })
    )
  );

  app.post(
    "/decisions/:id/freeze",
    wrap((req) =>
      decisionService.freezeDecisionPackage(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.params.id,
        req.principal!.userId
      )
    )
  );

  // AUTH-5: approvedById is overridden with the authenticated principal's
  // userId — a body-supplied approvedById can no longer be used to
  // impersonate another (e.g. approver-role) user. approvalService.approve's
  // own role check (assertActorAuthorized, domain/authorization.ts) is
  // unchanged and still runs against this now-trustworthy id.
  app.post(
    "/approvals",
    wrap((req) =>
      approvalService.approve(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.body.decisionPackageId,
        req.principal!.userId
      )
    )
  );

  app.post(
    "/purchase-orders",
    wrap((req) =>
      purchaseOrderService.createPurchaseOrderFromApproval(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.body.approvalId,
        req.principal!.userId
      )
    )
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.name, message: err.message });
    if (err instanceof AuthorizationError) return res.status(403).json({ error: err.name, message: err.message });
    if (err instanceof ApprovalRequiredError) return res.status(409).json({ error: err.name, message: err.message });
    if (err instanceof CommercialDeviationError) return res.status(409).json({ error: err.name, message: err.message });
    if (err instanceof InvalidStateError) return res.status(409).json({ error: err.name, message: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.name, message: err.message });
    // Any Prisma error reaching here is an unanticipated one (every
    // expected one — unique/FK violations, not-found — is already caught
    // and translated inside the relevant service). Never forward Prisma's
    // own error message/meta to the client; log server-side only.
    if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientValidationError) {
      console.error("Unhandled Prisma error:", err);
      return res.status(500).json({ error: "InternalError", message: "A database error occurred." });
    }
    console.error(err);
    return res.status(500).json({ error: "InternalError", message: "Unexpected error." });
  });

  return app;
}

// Composition-root authenticator (AUTHN Step 6A). The production runtime
// now uses the real, session-backed Authenticator (sessionAuthenticator.ts)
// — browser session cookie -> findActiveSessionByRawToken -> User ->
// Principal{userId, tenantId}, exactly as ratified. No OIDC issuer/subject,
// email, role, or any other identity concept enters Principal; the
// authentication middleware above and every existing route are otherwise
// completely unchanged by this swap.
const app = createApp(sessionAuthenticator);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Procurement vertical slice API listening on :${port}`);
  });
}

export { app };
