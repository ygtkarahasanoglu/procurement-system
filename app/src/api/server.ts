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
import * as rfqDispatchService from "../services/rfqDispatchService";
import type { SendRFQDispatchDeps } from "../services/rfqDispatchService";
import { Prisma } from "@prisma/client";
import { AuthorizationError } from "../domain/authorization";
import { NotFoundError, InvalidStateError, ApprovalRequiredError, CommercialDeviationError, ValidationError } from "../domain/errors";
import type { Authenticator, Principal } from "./principal";
import { assertTenantMatches } from "./tenantBinding";
import { createAuthRouter } from "./authRoutes";
import { sessionAuthenticator } from "./sessionAuthenticator";
import { sendGridEmailSender } from "./sendgridEmailSender";
import { createDevEmailSender } from "./devEmailSender";
import {
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  verifySendGridSignature,
  isSignatureTimestampFresh,
  loadWebhookVerificationKeyFromEnv,
} from "./sendgridWebhookVerification";
import { mapSendGridEvent, recordProviderDeliveryEvent } from "../services/providerDeliveryEventService";

// Default RFQ SEND dependencies for every existing/future createApp()
// caller that does not explicitly inject its own (every existing test
// file calls createApp(authenticator) with one argument — this default
// keeps all of them compiling and behaving exactly as before).
// RFQ-EP1 (docs/decisions/ratified.md): Twilio SendGrid is now the real,
// wired default — unconfiguredEmailSender is no longer used here. A
// deployment without SENDGRID_API_KEY/SENDGRID_FROM_EMAIL set does not
// fail to start; each individual send attempt fails deterministically
// instead (sendgridEmailSender.ts's own lazy config load).
const DEFAULT_SEND_DEPS: SendRFQDispatchDeps = {
  emailSender: sendGridEmailSender,
  responseBaseUrl: "http://localhost:3000",
};

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
export function createApp(authenticator: Authenticator, sendDeps: SendRFQDispatchDeps = DEFAULT_SEND_DEPS) {
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
  // Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
  // (docs/decisions/ratified.md). Mounted here, BEFORE app.use(express.json())
  // below and BEFORE the Principal authentication middleware further down:
  // this is a server-to-server SendGrid webhook with no browser session and
  // no Principal (the same unauthenticated-carve-out reasoning as /auth and
  // /rfq-responses/:token elsewhere in this file), and RFQ-PD15 requires the
  // exact RAW request body for signature verification — once express.json()
  // parses a request, the original bytes are gone. A route-scoped
  // express.raw() (never a global body-parser change, per the implementation
  // brief's own instruction to prefer route-scoped handling) is how the raw
  // body is obtained here without affecting any other endpoint. This handler
  // always responds and never calls next(), so express.json() below never
  // runs for this path.
  app.post(
    "/webhooks/sendgrid/events",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "ValidationError", message: "Request body must be application/json." });
      }
      const rawBody = req.body as Buffer;
      const signature = req.header(SENDGRID_SIGNATURE_HEADER);
      const timestamp = req.header(SENDGRID_TIMESTAMP_HEADER);
      if (!signature || !timestamp) {
        console.error("[sendgrid-webhook] rejected: missing signature/timestamp header.");
        return res.status(403).json({ error: "Forbidden", message: "Webhook authentication failed." });
      }

      let verificationKey: string;
      try {
        verificationKey = loadWebhookVerificationKeyFromEnv();
      } catch (err) {
        console.error("[sendgrid-webhook] verification key not configured:", err instanceof Error ? err.message : String(err));
        return res.status(500).json({ error: "InternalError", message: "Webhook is not configured." });
      }

      // RFQ-PD15: fail closed on EITHER an invalid signature OR a stale
      // signing timestamp — strictly before any JSON parsing, tenant
      // derivation, or domain processing. Never distinguishes which check
      // failed in the response, mirroring this codebase's existing
      // generic-rejection discipline (RFQ-R2/R3's indistinguishable
      // invalid-token rejection). Never logs the signature, timestamp
      // value, verification key, or raw payload content.
      const signatureValid = verifySendGridSignature({
        publicKeyBase64: verificationKey,
        signatureBase64: signature,
        timestamp,
        rawBody,
      });
      const timestampFresh = isSignatureTimestampFresh(timestamp);
      if (!signatureValid || !timestampFresh) {
        console.error(
          `[sendgrid-webhook] rejected: authentication failed (signatureValid=${signatureValid}, timestampFresh=${timestampFresh}).`
        );
        return res.status(403).json({ error: "Forbidden", message: "Webhook authentication failed." });
      }

      // Only reached after successful authentication (RFQ-PD15) — JSON
      // parsing, correlation, and persistence all happen strictly after
      // this point, never before it.
      let events: unknown;
      try {
        events = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "ValidationError", message: "Request body is not valid JSON." });
      }
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: "ValidationError", message: "Request body must be a JSON array." });
      }

      // Each event is recorded independently — one malformed/unmappable
      // item (mapSendGridEvent returning null, RFQ-PD7) or one failed
      // write never blocks the rest of the batch. recordProviderDeliveryEvent
      // is itself idempotent under (provider, providerEventId) duplication
      // (RFQ-PD6), so SendGrid's documented at-least-once redelivery is safe.
      let recorded = 0;
      for (const rawEvent of events) {
        const mapped = mapSendGridEvent(rawEvent);
        if (!mapped) continue;
        try {
          await recordProviderDeliveryEvent(mapped);
          recorded++;
        } catch (err) {
          console.error(
            "[sendgrid-webhook] failed to record one provider delivery event:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }
      console.log(`[sendgrid-webhook] authenticated batch of ${events.length} event(s), recorded ${recorded}.`);
      return res.status(200).json({ received: true });
    }
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

  // Supplier Response / Quote Ingestion V1 (RFQ-R1–RFQ-R5,
  // docs/decisions/ratified.md). Mounted here, BEFORE the Principal
  // authentication middleware below, for the same reason /auth is: this
  // route has no browser session and must be reachable by an external
  // party with no Principal at all. The opaque response token in the
  // path is the sole authoritative identifier (RFQ-R2) — req.body is
  // never trusted for targeting, only for the four RFQ-R5 commercial
  // fields, and rfqDispatchService.submitSupplierResponse itself rejects
  // any other field outright. This is the only unauthenticated carve-out
  // this route introduces — every other route remains exactly as
  // Principal-protected as before.
  app.post(
    "/rfq-responses/:token",
    wrap((req) => rfqDispatchService.submitSupplierResponse(req.params.token, req.body))
  );

  // RFQ UI End-to-End V1. Read-only counterpart to the POST above, for
  // the supplier-facing form to show what it's quoting against before
  // submitting — same unauthenticated carve-out, same reasoning, mounted
  // immediately alongside it. Never consumes the token (no respondedAt
  // write, no status write) — getSupplierResponseContext performs no
  // mutation at all. Uses the identical generic-rejection semantics as
  // the POST (RFQ-R2/R3): an invalid, expired, or already-consumed token
  // all produce the same NotFoundError, never a distinguishing signal.
  app.get(
    "/rfq-responses/:token",
    wrap((req) => rfqDispatchService.getSupplierResponseContext(req.params.token))
  );

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

  // RFQ-EH7 (docs/decisions/ratified.md): identical authorization shape
  // to the workflow route immediately above — authenticated,
  // tenant-bound via assertTenantMatches, no new role/permission
  // taxonomy. Deliberately a separate route, not folded into
  // /workflow, per queryService.listRfqCommunicationEvents's own
  // comment. Never reachable from the unauthenticated, token-scoped
  // supplier response routes below — those take no req.principal at
  // all.
  app.get(
    "/rfq-dispatches/:id/events",
    wrap((req) =>
      queryService.listRfqCommunicationEvents(assertTenantMatches(req.principal!, req.query.tenantId as string), req.params.id)
    )
  );

  // Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
  // (docs/decisions/ratified.md). Identical authorization shape to the
  // route immediately above — authenticated, tenant-bound via
  // assertTenantMatches, no new role/permission taxonomy, reusing
  // RFQ-EH7's floor rather than inventing a new one. Deliberately a
  // separate route, not folded into /events, mirroring that same
  // decision's own reasoning for keeping this a distinct model/read
  // path. See queryService.listRfqProviderDeliveryEvents's own comment
  // for why this model needs an explicit, manual tenant check rather
  // than the automatic R15/SEC-012 backstop.
  app.get(
    "/rfq-dispatches/:id/provider-events",
    wrap((req) =>
      queryService.listRfqProviderDeliveryEvents(
        assertTenantMatches(req.principal!, req.query.tenantId as string),
        req.params.id
      )
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
  //
  // FX-1 (docs/decisions/ratified.md): optional rateType ("SELLING" |
  // "BUYING", default SELLING). req.body.rateType is passed through
  // as-is — undefined triggers generateRecommendation's own default
  // parameter; any other invalid value is rejected by that function's
  // own runtime check (ValidationError -> 400 via the existing error
  // middleware below), so no separate validation is duplicated here.
  app.post(
    "/recommendations",
    wrap((req) =>
      recommendationService.generateRecommendation(
        assertTenantMatches(req.principal!, req.body.tenantId),
        req.body.sourcingEventId,
        req.body.rateType
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

  // RFQ UI End-to-End V1. Wires the existing createRFQDispatch service
  // (unchanged) to HTTP for the first time — no route previously existed
  // for it. Same pattern as /rfq-dispatches/:id/send below: tenantId
  // comes exclusively from req.principal, never from the request body, so
  // there is no client-supplied tenantId to validate (no
  // assertTenantMatches call, same reasoning as GET /tenants above).
  // createRFQDispatch itself applies no role-based authorization gate
  // (deliberately, per its own comment — it mirrors
  // sourcingService.createSourcingEvent/quoteService.submitQuote's
  // ungated "prepare" tier) and this route does not add one either, for
  // the same consistency reason.
  app.post(
    "/rfq-dispatches",
    wrap(async (req) => {
      const dispatch = await rfqDispatchService.createRFQDispatch(
        req.principal!.tenantId,
        req.body.sourcingEventId,
        req.body.supplierId
      );
      // Defense-in-depth: createRFQDispatch's own return shape is
      // unchanged (responseTokenHash/tokenExpiresAt are always null at
      // this point — no token has been issued yet), but this route never
      // forwards those field names over the wire at all, consistent with
      // the same minimal-exposure discipline applied to the workflow GET
      // (queryService.getRequestLineWorkflow).
      return { id: dispatch.id, sourcingEventId: dispatch.sourcingEventId, supplierId: dispatch.supplierId, status: dispatch.status, createdAt: dispatch.createdAt };
    })
  );

  // RFQ-S1/RFQ-S2 (docs/decisions/ratified.md). No client-supplied
  // tenantId/actorUserId/role — both come exclusively from req.principal,
  // exactly like /sourcing-events and /recommendations above. No
  // assertTenantMatches call: this route takes no external tenant claim
  // to validate at all (same reasoning as GET /tenants above) — the
  // principal's own tenantId is simply the sole input.
  app.post(
    "/rfq-dispatches/:id/send",
    wrap(async (req) => {
      const result = await rfqDispatchService.sendRFQDispatch(req.principal!.tenantId, req.principal!.userId, req.params.id, sendDeps);
      // Dispatch-id-aware log line, here rather than in
      // rfqDispatchService.ts, which deliberately never logs anything
      // (see supplierResponse.test.ts). Never logs the response token,
      // tenant/actor id, or any secret — only the dispatch id (already
      // a public URL path segment) and its resulting status.
      console.log(`[rfq-send] dispatch=${req.params.id} outcome=${result.status}`);
      return result;
    })
  );

  // RFQ-RT1/RFQ-RT3 (docs/decisions/ratified.md) — same-dispatch retry,
  // a distinct action from first SEND above, not a wider acceptance set
  // on it. Same auth/tenant shape as /send (no client-supplied
  // tenantId/actorUserId/role; both come exclusively from req.principal;
  // no assertTenantMatches call, same reasoning as /send above) — the
  // route grants no broader or narrower authority than /send, only a
  // different starting-state acceptance (SEND_FAILED only, enforced by
  // retryRFQDispatch's own CAS).
  app.post(
    "/rfq-dispatches/:id/retry",
    wrap(async (req) => {
      const result = await rfqDispatchService.retryRFQDispatch(req.principal!.tenantId, req.principal!.userId, req.params.id, sendDeps);
      console.log(`[rfq-retry] dispatch=${req.params.id} outcome=${result.status}`);
      return result;
    })
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
// RFQ UI End-to-End V1: strictly opt-in development/demo email capture.
// Unset (the default, and the only configuration any real deployment
// should ever use) leaves `app` wired exactly as before — createApp's own
// DEFAULT_SEND_DEPS (unconfiguredEmailSender), untouched. Only an
// operator explicitly setting RFQ_DEV_EMAIL_CAPTURE=1 in their own local
// environment activates this; it cannot be reached by any request, and
// selects no real email provider (provider selection remains OPEN,
// docs/decisions/open.md). The onCapture callback here is a dedicated,
// explicitly-labeled, dev-only output — never the shared console.error
// error-handling path used elsewhere in this file — and only ever prints
// anything when this opt-in branch is active.
const app =
  process.env.RFQ_DEV_EMAIL_CAPTURE === "1"
    ? createApp(sessionAuthenticator, {
        emailSender: createDevEmailSender((email) => {
          console.log(`[DEV EMAIL CAPTURE] To: ${email.to}\nSubject: ${email.subject}\n\n${email.body}\n`);
        }).sender,
        responseBaseUrl: process.env.RFQ_RESPONSE_BASE_URL ?? "http://localhost:5173",
      })
    : createApp(sessionAuthenticator);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Procurement vertical slice API listening on :${port}`);
  });
}

export { app };
