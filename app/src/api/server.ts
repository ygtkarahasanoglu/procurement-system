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
import { Prisma } from "@prisma/client";
import { AuthorizationError } from "../domain/authorization";
import { NotFoundError, InvalidStateError, ApprovalRequiredError, CommercialDeviationError, ValidationError } from "../domain/errors";

// API layer for the backend, consumed by the web UI under app/web (a
// separate Vite dev server/origin — hence `cors()` below) and still
// usable directly via curl/HTTP for manual exercise. There is NO
// authentication middleware here — tenantId/actingUserId are read
// directly from the request body/query. See README "Authorization" /
// "Tenant isolation" limitations: this is sufficient to prove the
// domain/service-layer invariants are enforced independent of the API
// layer, but is not a production authentication boundary. The UI never
// bypasses this layer — it has no direct Prisma/PostgreSQL access.

const app = express();
app.use(cors());
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

// Read-only views for the UI (section 19: reuse existing endpoints
// wherever possible; these are the minimum new reads the UI genuinely
// needs and none of them perform or duplicate any business rule — see
// queryService.ts).
app.get("/tenants", wrap(() => queryService.listTenants()));
app.get("/tenants/:id/context", wrap((req) => queryService.getTenantContext(req.params.id)));
app.get("/requests", wrap((req) => queryService.listRequests(req.query.tenantId as string)));
app.get(
  "/request-lines/:id/workflow",
  wrap((req) => queryService.getRequestLineWorkflow(req.query.tenantId as string, req.params.id))
);

app.post("/requests", wrap((req) => requestService.createRequest(req.body)));

app.post(
  "/sourcing-events",
  wrap((req) => sourcingService.createSourcingEvent(req.body.tenantId, req.body.requestLineId))
);

app.post("/quotes", wrap((req) => quoteService.submitQuote(req.body)));

app.get(
  "/sourcing-events/:id/quote-versions",
  wrap((req) => quoteService.listQuoteVersionsForSourcingEvent(req.query.tenantId as string, req.params.id))
);

app.post(
  "/recommendations",
  wrap((req) => recommendationService.generateRecommendation(req.body.tenantId, req.body.sourcingEventId))
);

app.post("/decisions", wrap((req) => decisionService.formDecision(req.body)));

app.patch("/decisions/:id", wrap((req) => decisionService.reviseDecision({ ...req.body, decisionPackageId: req.params.id })));

app.post(
  "/decisions/:id/freeze",
  wrap((req) => decisionService.freezeDecisionPackage(req.body.tenantId, req.params.id, req.body.actingUserId))
);

app.post(
  "/approvals",
  wrap((req) => approvalService.approve(req.body.tenantId, req.body.decisionPackageId, req.body.approvedById))
);

app.post(
  "/purchase-orders",
  wrap((req) =>
    purchaseOrderService.createPurchaseOrderFromApproval(req.body.tenantId, req.body.approvalId, req.body.actingUserId)
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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Procurement vertical slice API listening on :${port}`);
  });
}

export { app };
