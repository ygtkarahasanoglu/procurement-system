import { tenantScoped, prisma } from "../db/client";
import { NotFoundError, InvalidStateError, ValidationError } from "../domain/errors";
import { assertActorAuthorized } from "../domain/authorization";
import { requireId, requireNonEmptyString, requirePositiveDecimal, requireUnit, requireCurrency } from "../domain/validation";
import { generateRawToken, hashToken } from "../api/rfqResponseToken";
import type { EmailSender } from "../api/emailSender";
import { composeRfqEmail, buildResponseUrl } from "./rfqEmailComposer";

// RFQ response lifetime — an IMPLEMENTATION-ONLY DEFAULT, not a ratified
// business policy. Unlike session.ts's SESSION_LIFETIME_MS (traceable to
// AUTHN-4), no equivalent decision exists in docs/decisions/ for how
// long an RFQ response window should remain open. Chosen as a plausible
// placeholder; revisit if/when a real duration requirement is ratified.
const RFQ_RESPONSE_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // ~14 days

// R1 (docs/decisions/ratified.md): RFQ = SourcingEvent + RFQDispatch x N.
// This is the prepare/create side only (SEC-014, "Prepare != Transmit")
// — creating an RFQDispatch never implies an email was sent, a supplier
// was contacted, or any other external side effect. Token generation
// (responseTokenHash/tokenExpiresAt), email dispatch, and supplier
// response capture are all separate, later batches; this function
// leaves both fields unset (null), exactly as the PENDING-only schema
// default already does.
//
// No role-based authorization gate is applied here, deliberately
// mirroring sourcingService.createSourcingEvent and
// quoteService.submitQuote: domain/authorization.ts's own comment
// states assertActorAuthorized is applied only to freezing a
// DecisionPackage, creating an Approval, and creating a PurchaseOrder —
// "Request/quote creation are not gated here in V1." An RFQDispatch
// sits in that same ungated tier (it is the prepare step preceding any
// consequential/approval-like action), so this follows the existing
// convention rather than inventing a new one.
//
// RFQ resend policy is OPEN (docs/decisions/open.md) — this function
// deliberately does not check for, or reject, an existing RFQDispatch
// for the same (sourcingEventId, supplierId) pair. Multiple dispatches
// for the same pair are allowed, exactly as Batch 1's schema (no
// uniqueness constraint there) already permits.
export async function createRFQDispatch(tenantId: string, sourcingEventId: string, supplierId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
  const validSupplierId = requireId(supplierId, "supplierId");
  const db = tenantScoped(validTenantId);

  // Existence + tenant check only — the same shape as every sibling
  // check in this codebase (sourcingService.createSourcingEvent,
  // quoteService.submitQuote), and deliberately not a new SourcingEvent
  // lifecycle rule: no sibling service conditions a write on
  // SourcingEvent.status, so this function does not either. A
  // cross-tenant or nonexistent id is rejected identically
  // (NotFoundError), never distinguished.
  const sourcingEvent = await db.sourcingEvent.findFirst({
    where: { id: validSourcingEventId, tenantId: validTenantId },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", validSourcingEventId);
  }

  const supplier = await db.supplier.findFirst({
    where: { id: validSupplierId, tenantId: validTenantId },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier", validSupplierId);
  }

  return db.rFQDispatch.create({
    data: { tenantId: validTenantId, sourcingEventId: validSourcingEventId, supplierId: validSupplierId },
  });
}

// Generates and persists a fresh supplier-response capability token for
// an existing RFQDispatch. Prepare/create (Batch 2) and token issuance
// (this function) are deliberately separate: nothing in this codebase
// calls this yet — it is not wired to RFQDispatch creation, and not
// wired to any SEND step (which does not exist yet either). See the
// RFQ Batch 3 assessment for why issuance belongs immediately before a
// future SEND, not at PENDING creation.
//
// The raw token is generated and hashed via rfqResponseToken.ts (pure
// crypto, no DB access of its own) and returned to the caller exactly
// once; only its SHA-256 hash is ever persisted, mirroring session.ts's
// own createSession discipline. The atomic conditional update
// (updateMany with tenantId in `where`, count === 0 -> NotFoundError)
// mirrors productService.updateProduct/supplierService.updateSupplier
// exactly — a cross-tenant or nonexistent rfqDispatchId is rejected
// identically to a nonexistent one, never distinguished.
//
// Calling this a second time for the same RFQDispatch simply rotates
// the token: a fresh raw token/hash is generated and overwrites the
// previous one, so the previous raw token's hash no longer matches
// anything persisted. This is ONLY a token-rotation mechanic — it does
// not decide, imply, or encode RFQ resend policy, single-use response
// policy, or quote revision policy, all of which remain OPEN
// (docs/decisions/open.md) and are not touched by this function.
export async function issueResponseToken(tenantId: string, rfqDispatchId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRfqDispatchId = requireId(rfqDispatchId, "rfqDispatchId");
  const db = tenantScoped(validTenantId);

  const rawToken = generateRawToken();
  const responseTokenHash = hashToken(rawToken);
  const tokenExpiresAt = new Date(Date.now() + RFQ_RESPONSE_TOKEN_LIFETIME_MS);

  const result = await db.rFQDispatch.updateMany({
    where: { id: validRfqDispatchId, tenantId: validTenantId },
    data: { responseTokenHash, tokenExpiresAt },
  });
  if (result.count === 0) {
    throw new NotFoundError("RFQDispatch", validRfqDispatchId);
  }

  return { rawToken, tokenExpiresAt };
}

// Injected dependency, mirroring createApp(authenticator)'s own existing
// seam for an externally-selected implementation — sendRFQDispatch is the
// first RFQ service function with a genuine external side effect, so it
// is the first to need this. No real email provider is selected or
// integrated by this function or by any default supplied for it
// (provider selection remains OPEN, docs/decisions/open.md).
export interface SendRFQDispatchDeps {
  emailSender: EmailSender;
  responseBaseUrl: string;
}

// RFQ-S1/RFQ-S2 (docs/decisions/ratified.md) — the SEND boundary. Exact
// ordering, each step justified by the RFQ SEND implementation-design
// assessment and its CAS/SENDING and authorization-role follow-ups:
//
//   1. authorize (assertActorAuthorized) — before any dispatch-specific
//      lookup, so an unauthorized actor never learns anything about
//      whether/where the target dispatch exists (mirrors
//      approvalService.approve's own authorize-then-lookup order).
//   2. tenant-scoped preflight lookup — resolves the whole composition
//      graph (RFQDispatch -> Supplier, -> SourcingEvent -> RequestLine
//      -> Product) in one read via Prisma relations; ordinary
//      NotFoundError for missing/cross-tenant, indistinguishable as
//      always.
//   3. deterministic preflight validation — Supplier.email is the only
//      nullable field anywhere in this composition graph; if null, the
//      dispatch is left PENDING, untouched, and InvalidStateError is
//      thrown. This is not an "unknown provider outcome" — it is a
//      fully local, deterministic fact known before any external
//      attempt, so it must never be allowed to enter SENDING at all.
//   4. CAS claim (PENDING -> SENDING) — the sole authoritative exclusive
//      claim; count === 0 is never distinguished by cause (race,
//      already SENDING/SENT/SEND_FAILED) beyond a single InvalidStateError.
//   5. token issuance — only after a successful claim. If this throws,
//      the dispatch is deliberately left in SENDING: no SEND_FAILED is
//      written for a token-issuance failure, and no email is attempted.
//      This is intentional, not an omission — see the stuck-SENDING
//      OPEN item in docs/decisions/open.md.
//   6. compose — pure, no DB, no side effect (rfqEmailComposer.ts).
//   7. EmailSender.send — the one true external side effect.
//   8. final state — tenant-scoped, state-conditioned. "unknown" leaves
//      SENDING untouched, per RFQ-S1; a final-write count === 0 is an
//      internal inconsistency (this exact caller already held the
//      exclusive SENDING claim), surfaced rather than silently ignored.
export async function sendRFQDispatch(
  tenantId: string,
  actorUserId: string,
  rfqDispatchId: string,
  deps: SendRFQDispatchDeps
) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validActorUserId = requireId(actorUserId, "actorUserId");
  const validRfqDispatchId = requireId(rfqDispatchId, "rfqDispatchId");

  await assertActorAuthorized(validTenantId, validActorUserId, ["procurement_user", "approver"]);

  const db = tenantScoped(validTenantId);

  const dispatch = await db.rFQDispatch.findFirst({
    where: { id: validRfqDispatchId, tenantId: validTenantId },
    include: {
      supplier: true,
      sourcingEvent: { include: { requestLine: { include: { product: true } } } },
    },
  });
  if (!dispatch) {
    throw new NotFoundError("RFQDispatch", validRfqDispatchId);
  }

  // Defense-in-depth only (RFQ SEND adversarial review): the R15 guard
  // validates the top-level RFQDispatch.findFirst's own where.tenantId,
  // but relations fetched via `include` are resolved as SQL JOINs within
  // that same query and are never independently re-checked by the guard.
  // Today this is non-exploitable — createRFQDispatch already validates
  // Supplier/SourcingEvent tenant membership before an RFQDispatch row
  // can ever exist, and no update/delete path anywhere in this codebase
  // can change a Supplier/SourcingEvent/RequestLine/Product's tenantId
  // afterward — but SEND is the first action with a real external
  // consequence, so this invariant is checked explicitly here rather
  // than trusted silently. A violation indicates a bug elsewhere, not a
  // normal cross-tenant resource lookup — it is therefore treated as an
  // internal-consistency failure (a plain Error, mapped generically to
  // a 500 response and never detailed to the calling route), not NotFoundError, and
  // it is checked before any claim/token/email side effect.
  if (
    dispatch.tenantId !== validTenantId ||
    dispatch.supplier.tenantId !== validTenantId ||
    dispatch.sourcingEvent.tenantId !== validTenantId ||
    dispatch.sourcingEvent.requestLine.tenantId !== validTenantId ||
    dispatch.sourcingEvent.requestLine.product.tenantId !== validTenantId
  ) {
    throw new Error(
      `Internal inconsistency: RFQDispatch ${validRfqDispatchId}'s related data does not all belong to tenant ${validTenantId}.`
    );
  }

  if (!dispatch.supplier.email) {
    throw new InvalidStateError(
      `Supplier ${dispatch.supplierId} has no email address on file; RFQDispatch ${validRfqDispatchId} cannot be sent.`
    );
  }

  const claim = await db.rFQDispatch.updateMany({
    where: { id: validRfqDispatchId, tenantId: validTenantId, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (claim.count === 0) {
    throw new InvalidStateError(
      `RFQDispatch ${validRfqDispatchId} is not available to claim for SEND (not PENDING, or claimed concurrently).`
    );
  }

  const { rawToken } = await issueResponseToken(validTenantId, validRfqDispatchId);

  const requestLine = dispatch.sourcingEvent.requestLine;
  const composed = composeRfqEmail({
    supplierEmail: dispatch.supplier.email,
    supplierName: dispatch.supplier.name,
    productName: requestLine.product.name,
    requestedQuantity: requestLine.requestedQuantity.toString(),
    unit: requestLine.unit,
    responseUrl: buildResponseUrl(deps.responseBaseUrl, rawToken),
  });

  const outcome = await deps.emailSender.send({
    to: composed.to,
    subject: composed.subject,
    body: composed.body,
  });

  if (outcome.kind === "unknown") {
    return { status: "SENDING" as const };
  }

  const finalStatus = outcome.kind === "success" ? ("SENT" as const) : ("SEND_FAILED" as const);
  const final = await db.rFQDispatch.updateMany({
    where: { id: validRfqDispatchId, tenantId: validTenantId, status: "SENDING" },
    data: { status: finalStatus },
  });
  if (final.count === 0) {
    throw new Error(
      `Internal inconsistency: RFQDispatch ${validRfqDispatchId} was not in SENDING when recording its final SEND outcome.`
    );
  }

  return { status: finalStatus };
}

// Supplier Response / Quote Ingestion V1 — RFQ-R1 through RFQ-R5
// (docs/decisions/ratified.md). The only client-supplied identifier is
// the opaque raw token itself (RFQ-R2); every other field a submission
// could conceivably name (dispatchId, supplierId, quoteId, tenantId,
// sourcingEventId, productId) is explicitly REJECTED, never silently
// ignored — see RFQ-R2's own "Implication" clause. Token possession is
// a capability, not authentication, not supplier identity proof, not
// Execution Authority (RFQ-R1) — this function makes no claim about who
// submitted the response, only that the submitter possessed a valid,
// unexpired, unconsumed token scoped to exactly one RFQDispatch.
const SUPPLIER_RESPONSE_ALLOWED_FIELDS = new Set(["quantity", "unit", "unitPrice", "currency"]);

export async function submitSupplierResponse(rawToken: string, payload: unknown) {
  const validRawToken = requireNonEmptyString(rawToken, "token");

  // RFQ-R2's explicit implication: unsupported fields are rejected, not
  // silently discarded — this is what makes the targeting boundary
  // observable/testable rather than merely assumed. No provided key may
  // fall outside the four RFQ-R5 commercial fields, for any reason.
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Request body must be an object.");
  }
  const providedFields = Object.keys(payload as Record<string, unknown>);
  const unsupportedFields = providedFields.filter((field) => !SUPPLIER_RESPONSE_ALLOWED_FIELDS.has(field));
  if (unsupportedFields.length > 0) {
    throw new ValidationError(
      `Unsupported field(s): ${unsupportedFields.join(", ")}. Only quantity, unit, unitPrice, and currency are accepted — ` +
        `the target RFQDispatch/tenant/supplier/product are derived exclusively from the response token, never from the request body.`
    );
  }
  const body = payload as Record<string, unknown>;

  // Bare prisma — the only legitimate use anywhere in this function.
  // Mirrors session.ts's own findActiveSessionByRawToken precedent
  // exactly: tenantId is not yet known (it can only be learned from this
  // lookup's own result), so tenantScoped() cannot be constructed before
  // it. responseTokenHash is globally @unique (Batch 1), so this can
  // resolve at most one row regardless of tenant — no cross-tenant
  // ambiguity is possible at this step.
  const tokenHash = hashToken(validRawToken);
  const dispatch = await prisma.rFQDispatch.findUnique({
    where: { responseTokenHash: tokenHash },
    include: { sourcingEvent: { include: { requestLine: true } } },
  });

  // Generic, indistinguishable rejection for every invalid-token cause —
  // nonexistent, expired, or already consumed. Never reveals which (no
  // token-enumeration signal), exactly mirroring this codebase's
  // existing not-found discipline (TenantMismatchError, NotFoundError).
  const tokenIsUsable =
    dispatch !== null && dispatch.respondedAt === null && dispatch.tokenExpiresAt !== null && dispatch.tokenExpiresAt > new Date();
  if (!dispatch || !tokenIsUsable) {
    throw new NotFoundError("RFQDispatch", "token");
  }

  // Defense-in-depth tenant invariant (same discipline as sendRFQDispatch
  // above): the nested `include` above is not independently re-checked
  // by the R15 guard (it was fetched via bare prisma, before tenant
  // context existed at all). createRFQDispatch's own creation-time
  // validation, and the absence of any tenantId-mutating update/delete
  // path anywhere in this codebase, already guarantee this cannot
  // diverge in practice — checked explicitly anyway, since this is an
  // unauthenticated boundary with a real external submitter.
  if (dispatch.tenantId !== dispatch.sourcingEvent.tenantId || dispatch.tenantId !== dispatch.sourcingEvent.requestLine.tenantId) {
    throw new Error(`Internal inconsistency: RFQDispatch ${dispatch.id}'s related data does not all belong to tenant ${dispatch.tenantId}.`);
  }

  // RFQ-R5: reject, never coerce. Same helpers quoteService.submitQuote
  // already uses for the identical manually-entered-quote fields — no
  // new business policy (MOQ, currency allowlist, custom precision) is
  // introduced here.
  const quotedQuantity = requirePositiveDecimal(body.quantity, "quantity");
  const unit = requireUnit(body.unit);
  const unitPrice = requirePositiveDecimal(body.unitPrice, "unitPrice");
  const currency = requireCurrency(body.currency);

  const db = tenantScoped(dispatch.tenantId);

  // RFQ-R4: token consumption and QuoteVersion creation in one local
  // transaction — unlike sendRFQDispatch's own transaction boundary
  // (which deliberately excludes the external EmailSender call), there
  // is no external call anywhere in this flow, so full atomicity is both
  // possible and correct here.
  return db.$transaction(async (tx) => {
    // RFQ-R3: the sole authoritative consumption check — atomic,
    // conditional, not a prior SELECT followed by a separate UPDATE. Of
    // two concurrent submissions against the same token, exactly one
    // can ever satisfy this WHERE clause.
    const claim = await tx.rFQDispatch.updateMany({
      where: {
        id: dispatch.id,
        tenantId: dispatch.tenantId,
        responseTokenHash: tokenHash,
        respondedAt: null,
        tokenExpiresAt: { gt: new Date() },
      },
      data: { respondedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new NotFoundError("RFQDispatch", "token");
    }

    // RFQ-R3's own clarification: respondedAt is the sole authoritative
    // consumption marker. RFQDispatch.status is deliberately NOT written
    // here — it is left exactly as RFQ-S1 already left it; no RESPONDED
    // (or any other) status transition is part of this ratification.

    // Mirrors quoteService.submitQuote's own creation shape exactly,
    // with every identifier (sourcingEventId, supplierId, productId)
    // derived from the token-resolved RFQDispatch/RequestLine, never
    // from the request body. rfqDispatchId traces this response back to
    // the dispatch that solicited it (the existing, already-nullable
    // SupplierQuote.rfqDispatchId field from Batch 1).
    return tx.supplierQuote.create({
      data: {
        tenantId: dispatch.tenantId,
        sourcingEventId: dispatch.sourcingEventId,
        supplierId: dispatch.supplierId,
        rfqDispatchId: dispatch.id,
        versions: {
          create: {
            tenantId: dispatch.tenantId,
            versionNumber: 1,
            productId: dispatch.sourcingEvent.requestLine.productId,
            quotedQuantity,
            unit,
            unitPrice,
            currency,
          },
        },
      },
      include: { versions: true },
    });
  });
}
