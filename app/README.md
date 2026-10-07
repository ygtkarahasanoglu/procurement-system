# Procurement System — MVP Vertical Slice (V1)

This directory is the first real, runnable implementation of the
procurement workflow documented in `../docs/`. It implements exactly one
scenario end-to-end — nothing more — to prove the ratified domain can
actually execute, not just be designed.

## Scope

```
ProcurementRequest -> RequestLine -> SourcingEvent -> SupplierQuote/QuoteVersion
  -> AI Recommendation (deterministic/test) -> Human Decision Formation
  -> Frozen DecisionPackage -> Approval -> PurchaseOrder
```

Target scenario: Product A, Requested Quantity 100 EA; Supplier A quotes
100 EA x EUR 10, Supplier B quotes 80 EA x EUR 9.50; deterministic
recommendation picks Supplier A (100 EA, full coverage, lowest price
among full-coverage quotes); human revises the selection down to 90 EA;
DecisionPackage is frozen at 90 EA; Approval is granted; the
PurchaseOrder is created strictly from the approved decision at 90 EA.

## Stack

- **TypeScript** (Node 22, CommonJS output)
- **PostgreSQL 16** — chosen because it's the only datastore the brief
  named, and the local environment already had it available without
  Docker (no Docker daemon was available in this environment, so local
  `postgresql-16` is used in place of the suggested Docker Compose; the
  `DATABASE_URL` connection string is the only thing that would need to
  change to run against a containerized Postgres instead).
- **Prisma 6.9** as the typed ORM/query layer and migration tool.
- **Express 4** as a thin API layer — chosen for being the simplest,
  most mature option that doesn't impose any particular architecture.
- **Vitest 2** as the test runner, run against a **real Postgres test
  database** (`procurement_test`) — not mocked — so passing tests are
  evidence the domain logic works against the real datastore, not just
  against an in-memory stand-in.

This stack was not chosen to contradict or narrow anything in
`../docs/architecture/`; nothing in this implementation closes any OPEN
architectural question. Database/runtime constraints such as "Approval
is INSERT-only," "QuoteVersion is immutable once created," and tenant
scoping are implemented as described below.

## Repository layout

```
app/
  prisma/schema.prisma        — data model (see "Domain model" below)
  prisma/migrations/          — two migrations: 20261002133918_init,
                                 20261005133036_add_authn_persistence
  src/db/client.ts            — shared Prisma client + the SEC-012/R15 runtime tenant guard
  src/domain/errors.ts        — domain error types, named after the rule each enforces
  src/domain/authorization.ts — minimum server-side authorization check (see "Authorization")
  src/services/               — one file per workflow stage (see "Domain rule enforcement")
  src/api/server.ts           — Express API exposing each service as an HTTP endpoint
  src/api/                    — also contains the authentication layer (session.ts,
                                 sessionAuthenticator.ts, oidc.ts, authRoutes.ts,
                                 externalIdentity.ts, tenantBinding.ts, principal.ts)
  src/scripts/provisionExternalIdentity.ts — one-time pilot operator identity mapping (AUTHN-12)
  src/seed/seed.ts            — development fixture data (explicitly marked as such)
  test/                       — Vitest suite (12 files, 233 tests as of this writing), run against real Postgres
  test-e2e/                   — Playwright suite (4 tests as of this writing), run against a real browser and the real dev servers
```

## Domain model (Prisma)

`Tenant`, `User`, `Product`, `Supplier`, `ProcurementRequest`,
`RequestLine`, `SourcingEvent`, `SupplierQuote`, `QuoteVersion`,
`RecommendationRecord`, `DecisionPackage`, `Approval`, `PurchaseOrder`
make up the procurement vertical slice itself; no other procurement
entity was created. `ExternalIdentity` and `Session` were added
separately for human authentication (`AUTHN-1`–`AUTHN-12`) — they are
identity/session persistence models, not part of the procurement domain.
In particular: **there is no `ApprovedQuantity` entity or field
anywhere** — `QS-C2` is implemented by simply never creating one;
Approval references a `DecisionPackage` and that is the only quantity
fact involved.

## Domain rule enforcement

| Rule | Status | Where / how |
|---|---|---|
| `CR-C` | **Implemented** | `decisionService.formDecision` takes a human-chosen `selectedQuantity` independent of any `RecommendationRecord`; `RecommendationRecord` is never read by decision/approval/PO services. Test 4 proves AI=100 vs. frozen=90. |
| `CR-A` | **Implemented** | `purchaseOrderService.createPurchaseOrderFromApproval` is the *only* PO-creation entry point and accepts no commercial fields — every PO field is copied from the Approval's `DecisionPackage`. |
| `CR-B.1` | **Implemented** | Same mechanism as CR-A — correspondence is structural, not merely checked after the fact. |
| `CR-B.2` | **Implemented (for the no-conversion case only)** | Quantity/unitPrice/unit/currency/supplier/product are copied with exact equality. No packaging/UOM-conversion scope is exercised — see Q3 below. |
| `CR-D1` | **Not exercised in V1** | No transformation/mapping step exists between DecisionPackage and PO beyond verbatim field copy — there is nothing to map in the EA->EA, same-currency scenario. |
| `CR-D2` | **Not exercised in V1** | No representational/technical transformation (e.g. unit relabeling, ERP identifier mapping) is implemented; not needed for this scenario. |
| `Q3` | **Implemented (for the no-conversion case only)** | `purchaseOrderService`'s deviation check compares quantity via `Prisma.Decimal` equality — exact economic-quantity correspondence holds trivially when unit and raw number are identical. The packaging-conversion engine (BOX -> EA, etc.) is explicitly **not implemented** per the brief. |
| `Q3-CV` | **Not exercised in V1** | No quantity/UOM/packaging conversion occurs anywhere in this slice (Supplier A/B both quote in EA), so the "known with certainty" evidentiary gate is never invoked. No R11 evidence pipeline (`CapturedEvidence -> AI Extraction -> StructuredClaim -> Validation -> PersistedClaim`) is implemented — building it solely to exercise Q3-CV on an EA->EA case, where it isn't triggered, was explicitly out of scope. |
| `APO-D1` | **Implemented** | `createPurchaseOrderFromApproval` looks up the Approval by `(id, tenantId)`; a missing/wrong-tenant Approval or a non-`FROZEN` DecisionPackage both reject PO creation (Test 7). |
| `APO-D2` | **Implemented (as a provenance/authorization-basis rule)** | Approval is the only thing `createPurchaseOrderFromApproval` consults; no Execution Authority, Capability, or transmission concept exists or is conflated with it — those remain entirely absent from this slice, consistent with APO-D2 keeping them distinct. |

**V1 cardinality simplifications — not ratified decisions:** at most one
`Approval` per `DecisionPackage`, and at most one `PurchaseOrder` per
`Approval` (both enforced via DB unique constraints). Real
Approval/DecisionPackage/PO cardinality remains OPEN per
`APO-D1`'s non-decisions and `Q3`'s non-decision #11 — this is a V1
implementation choice to keep the slice small, not a claim that
cardinality has been ratified.

## AI Recommendation — explicitly deterministic, explicitly non-authoritative

`recommendationService.generateRecommendation` implements a fixed,
documented rule (prefer full-coverage quotes, lowest price among them;
otherwise highest quantity, tie-broken by lowest price) under the
provider name `"deterministic-test-provider-v1"`, with
`isDeterministicTestProvider: true` stored on every record it produces.
**This is not, and must never be presented as, a real AI/LLM
integration.** The interface (`generateRecommendation(tenantId,
sourcingEventId) -> RecommendationRecord`) is the seam a real provider
would plug into later; nothing downstream depends on *how* a
`RecommendationRecord` was produced, only that it is never read as
authoritative.

## Tenant isolation — what is and is not implemented

Every authoritative table carries a `tenantId` column, and every service
function requires a `tenantId` and does all lookups via
`findFirst({ where: { id, tenantId } })` rather than `findUnique({ id })`
— so supplying another tenant's record id, without also knowing that
tenant's own id, cannot retrieve or mutate it (Test 9). This service-layer
scoping remains the **primary** tenant isolation mechanism (`R10`).

In addition, `SEC-012` ("runtime tenant guard") is now implemented as a
defense-in-depth backstop (`R15`, `../docs/decisions/ratified.md`): a
Prisma Client Extension (`tenantScoped()`, `src/db/client.ts`) validates
every tenant-scoped Prisma operation — including the authorization
hot-path (`domain/authorization.ts`) — against an authoritative tenant
context, independently of each service's own query construction. See
`test/tenantGuard.test.ts` for its dedicated coverage (implementation
commits `5126a11`, `efacff0`). This is **not** PostgreSQL Row-Level
Security — no RLS policy is configured, and whether RLS is adopted
remains a separate, still-OPEN decision (`../docs/decisions/open.md`).

## Authentication

Human-facing authentication is implemented per `AUTHN-1`–`AUTHN-12`
(`../docs/decisions/ratified.md`): OpenID Connect with Authorization Code
+ PKCE, server-side sessions persisted in PostgreSQL, and routes
`/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`. Every route
other than `/auth/*` requires a valid session cookie; the authenticated
identity is the existing `Principal { userId, tenantId }` (`AUTHN-6`,
unchanged), and a request's claimed `tenantId` is verified against that
Principal (`assertTenantMatches`) rather than trusted from the request
body. The pilot has completed a real browser login using Google as the
OIDC provider — this is a pilot provider choice (`AUTHN-1`), not a
ratified architectural commitment to Google specifically; the
implementation is generic at the OIDC protocol/claims boundary.

## Authorization — what is and is not implemented

`src/domain/authorization.ts` checks a plain `role` string on `User`
(`"procurement_user"` or `"approver"`) against an allow-list, applied
only to the three operations the brief named explicitly: freezing a
DecisionPackage, creating an Approval (requires `"approver"`), and
creating a PurchaseOrder. This is **not** the production RBAC/policy
system `U3`'s guardrails anticipate (no generic `authorize()`
abstraction was built, consistent with `U3`), and it is enforced only in
the service layer, not via any UI restriction — there is no UI.
Request/quote creation are not gated by role in V1; this is a known,
explicit limitation, not an oversight.

## Transactions

`purchaseOrderService.createPurchaseOrderFromApproval` runs its entire
check-then-create sequence (Approval lookup, DecisionPackage frozen
check, existing-PO check, PO creation) inside one
`tenantScoped(validTenantId).$transaction(...)` — there is no window
where a PO could be created without having just verified a valid
Approval in the same transaction, and every operation inside that
transaction is itself validated by the SEC-012/R15 runtime guard (see
"Tenant isolation" above).

## Known limitations (explicit)

- No ERP integration, no supplier email sending, no real AI provider —
  all explicitly out of scope per the brief.
- No multi-supplier allocation, MOQ policy, undercoverage/overcoverage
  policy, supplier/QuoteVersion substitution, or PO cardinality
  framework — all remain OPEN exactly as already scoped in
  `../docs/decisions/open.md` and in `Q3`/`APO-D1`'s own non-decisions.
- No packaging/UOM conversion engine (`Q3`'s BOX->EA case) and no R11
  evidence pipeline (`Q3-CV`) — neither is exercised by the EA->EA
  scenario this slice targets.
- Full RBAC (a generic authorization/policy system) is not implemented —
  see "Authorization" above. (`SEC-012`'s runtime tenant guard backstop
  is implemented — see "Tenant isolation" above.)
- A React frontend (`../web/`) provides an authenticated, single-screen
  workflow UI for this same scenario, covered by Playwright end-to-end
  tests (`test-e2e/workflow.spec.ts`). It is a thin client over the API
  below — no business rule lives in the frontend.
- `.env` / `.env.test` (not committed) point at a locally-running
  PostgreSQL 16 instance rather than a Dockerized one, since no Docker
  daemon was available in this environment — see "Stack" above.

## How to run locally

Prerequisites: Node 22+, a running PostgreSQL instance.

```bash
cd app
npm install

# One-time: point .env / .env.test at your Postgres instance
#   DATABASE_URL="postgresql://<user>:<password>@localhost:5432/procurement_dev?schema=public"
# and create both databases, e.g.:
#   createdb procurement_dev
#   createdb procurement_test

npm run db:migrate     # applies prisma/migrations to procurement_dev
npm test               # runs the 9 automated tests against procurement_test

npm run db:seed        # creates demo Tenant/Users/Product/Suppliers/Request (dev fixture only)
npm run dev:api        # starts the API on :3000
```

Manual walkthrough once the API is running (replace ids with the ones
`npm run db:seed` prints). These examples predate authentication and
assume a trusted caller; every route below now requires a valid session
cookie, and an unauthenticated request receives `401` — see
"Authentication" above for how a session is established:

```bash
curl -X POST localhost:3000/sourcing-events -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","requestLineId":"<requestLineId>"}'

curl -X POST localhost:3000/quotes -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","sourcingEventId":"<id>","supplierId":"<supplierAId>","productId":"<productAId>","quotedQuantity":100,"unit":"EA","unitPrice":10,"currency":"EUR"}'

curl -X POST localhost:3000/quotes -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","sourcingEventId":"<id>","supplierId":"<supplierBId>","productId":"<productAId>","quotedQuantity":80,"unit":"EA","unitPrice":9.5,"currency":"EUR"}'

curl -X POST localhost:3000/recommendations -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","sourcingEventId":"<id>"}'

curl -X POST localhost:3000/decisions -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","sourcingEventId":"<id>","sourceQuoteVersionId":"<quoteVersionAId>","selectedQuantity":90,"createdById":"<procurementUserId>"}'

curl -X POST localhost:3000/decisions/<decisionPackageId>/freeze -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","actingUserId":"<procurementUserId>"}'

curl -X POST localhost:3000/approvals -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","decisionPackageId":"<decisionPackageId>","approvedById":"<approverUserId>"}'

curl -X POST localhost:3000/purchase-orders -H 'content-type: application/json' \
  -d '{"tenantId":"<tenantId>","approvalId":"<approvalId>","actingUserId":"<procurementUserId>"}'
```

This exact sequence was run manually against a live server during
implementation and produced:
`{"supplierId":"<Supplier A>","productId":"<Product A>","quantity":"90","unit":"EA","unitPrice":"10","currency":"EUR"}`.

## Continuous Integration

`.github/workflows/ci.yml` (repository root) runs the backend test
suite above automatically on every push to `main` and every pull
request, against a disposable PostgreSQL 16 service container — never
a production database or credential. It reproduces exactly the local
sequence above: `npm ci` → `npm run db:generate` → `npx prisma migrate
deploy` (the non-interactive counterpart of `db:migrate`, used because
CI must not prompt or generate new migrations) → `npm run build`
(typecheck) → `npm test`. To reproduce the same test run locally,
the commands above (`npm run db:migrate`, `npm test`) are sufficient —
CI does not add any test behavior beyond what `npm test` already runs.

**Known pre-existing failure, not introduced by CI:** `test/
workflow.e2e.test.ts`'s own `resetDatabase()` deletes `SourcingEvent`
rows before `RFQDispatch` rows that reference them, which fails with a
foreign-key violation whenever an earlier test file in the same run has
left an `RFQDispatch` behind (several RFQ test files create fixtures
without their own teardown). This is a pre-existing gap in that one
test file's own cleanup ordering, unrelated to CI — CI surfaces it
rather than hiding it, and it is intentionally left unfixed here rather
than silently patched to produce an artificially green run.

**Not yet covered by CI:** the Playwright E2E suite (`test-e2e/`).
Its own `playwright.config.ts` documents that it assumes the backend
API (`:3000`) and frontend dev server (`:5173`) are already running as
externally-managed, already-started processes against `procurement_dev`
— it was never designed to self-start either server. Reliably
orchestrating that startup/readiness sequence in an ephemeral CI
runner would mean redesigning this suite's own execution model, which
is out of scope for this verification-gate addition; the backend
`vitest` suite above remains independently gated regardless.
