# Open Decision Register

Status: **OPEN, by definition.** No item in this register has been decided.
Nothing in this repository resolves any of these questions; any future
document that appears to resolve one without an explicit human ratification
event should be treated as an error and corrected, not built upon.

## Open items

- **D-1** — Role terminology collision (unresolved naming/overlap between
  role concepts identified in prior analysis).
- **D-2** — Authorization verb layering (how multiple authorization-related
  verbs/checks compose or layer at a given checkpoint).
- **D-3** — Authority revoked / capability lingers behavior (what happens
  when Authority is revoked but the underlying technical Capability has not
  yet been withdrawn, or vice versa).
- **D-4** — Delegated human approval (whether/how an approval can be
  delegated from one human to another, and what that means for M2's
  historical/tenant-level semantics).
- **D-5** — Explicit invalidation/cancellation mechanism. **Root question
  (D5-R1) is now RATIFIED — see dedicated status note below.** The
  conditional follow-on question **D5-R2 (successor traceability)** is now
  the active open item within this D-5 family.
- **D-6** — Compromised-worker-within-scope control (what containment
  applies if a worker/component with legitimate scope is compromised).
- **RQ-5** — Stale DecisionPackage enforcement mode (exactly how a STALE
  DecisionPackage is prevented from being acted upon — block, warn,
  re-generate, etc.).
- **R9 exact mechanism** — the requirement that control-weakening actions be
  authorized/auditable/distinguishable is RATIFIED (see `ratified.md`); the
  exact mechanism (e.g., dual control, specific approval workflow) is OPEN.
- **AUTHN-5 provisioning capability — naming, operator access, and
  lifecycle** — the production user-provisioning mechanism's semantic
  shape, the provisioning-authority boundary (separate from
  procurement-domain roles, tenant-scoped when exercised through the
  application, a domain-specific capability rather than a universal
  Authority entity, distinct from the existing AUTHN-12 operator
  path), the capability's minimal representation shape (an additive
  Boolean on `User`, defaulting to `false`, checked by a dedicated
  provisioning-specific authorization function rather than
  `assertActorAuthorized` or a generic `authorize()`), the bootstrap
  semantic direction (the first provisioning-capable `User` per tenant
  is established through an explicit, out-of-band, operator-level
  action outside the application's normal authorization model,
  distinct from AUTHN-12, introducing no tenant-admin role or
  platform-operator Principal), and the bootstrap implementation form
  (a standalone TypeScript operator script under `app/src/scripts/`,
  independent of AUTHN-12's `provisionExternalIdentity.ts`, not seed
  tooling, not an HTTP route, not a generic admin CLI/framework) are
  all RATIFIED (see `ratified.md`, AUTHN-5). Still OPEN: the exact
  Boolean field name; the exact authorization function name; the exact
  route/UI; the exact script/function/npm-script name; the exact CLI
  argument syntax; idempotency/repeat-run behavior; who operationally
  holds the operator access used for bootstrap, and how that access is
  managed; whether one or multiple provisioning-capable `User`s are
  permitted per tenant; whether every tenant automatically receives
  one; and whether a tenant-administrator concept is introduced. Who
  may grant/revoke the capability after bootstrap (the subsequent
  lifecycle, as distinct from the first grant, which is now settled
  above) remains OPEN as to its exact mechanism — it is now additionally
  RATIFIED only that holding the performing capability
  (`canProvisionExternalIdentities = true`) does **not**, by itself,
  confer that grant/revoke authority (see `ratified.md`, AUTHN-5,
  "Grant/Revoke Authority Separation"); the actual mechanism, actor
  model, self-grant/self-revoke policy, and minimum-capable-user policy
  are all still OPEN.
- **RLS** — whether Row-Level Security is adopted as a defense-in-depth
  layer alongside service-layer authorization (R10 in `ratified.md` settles
  only that service-layer authorization is primary).
- **FX provider/source** — which foreign-exchange rate provider/source is
  used to satisfy the mandatory multi-currency requirement (R6).
- **ProcurementMemory freshness threshold** — the requirement that
  ProcurementMemory carry freshness metadata is RATIFIED (R8); the specific
  threshold(s) that determine "fresh" vs. "stale" are OPEN.
- **StrongIdentifierType list/provenance** — the exact set of identifier
  types considered "strong" for the purposes of `is_verified_strong`
  (see `03-data-model.md`), and how their provenance is established.
- **Reconciliation schedule/scope** — how often, and over what scope, ERP
  reconciliation runs (see `03-data-model.md`, ERP sync section).
- **RFQ response token single-use/replay** — the *consumption mechanism*
  (atomic, single-use-on-successful-submission) is now RATIFIED (see
  `ratified.md`, `RFQ-R3`). Still OPEN: whether a *new* token may later be
  issued for a second attempt (resend/reissue policy), and whether an
  already-submitted response may ever be revised or superseded (tied to
  the quote revision/requote policy item below) — neither is resolved by
  `RFQ-R3`.
- **RFQ response token lifetime (business policy)** — the current RFQ
  response-token lifetime is an implementation-only default
  (`app/src/services/rfqDispatchService.ts`), not a ratified business
  policy; the actual required response window remains OPEN.
- **RFQ resend/retry policy** — `RFQ-RT1`–`RFQ-RT5` (`docs/decisions/ratified.md`)
  now RATIFY the core semantics: retry and resend are distinct concepts;
  a deterministic `SEND_FAILED` dispatch may be retried using the same
  `RFQDispatch` identity; a `SENDING` dispatch may never be same-dispatch
  retried/reclaimed; and a new, independent `RFQDispatch` may always be
  created under the same `SourcingEvent` for a fresh communication
  intent, leaving any prior dispatch's state/history unchanged (not
  duplicate-safe). Still OPEN and NOT resolved by `RFQ-RT1`–`RFQ-RT5`:
  whether/how an already-`SENT` or `RESPONDED` dispatch may be
  resent/re-contacted; and any replacement/lineage relation between
  dispatches (see the new bullet immediately below).
- **RFQDispatch replacement lineage / `SendAttempt` domain primitive** —
  `RFQ-RT5`'s Non-Goals (`docs/decisions/ratified.md`) ratify only that
  neither an explicit replacement relation (e.g. `replacementOfDispatchId`)
  nor a `SendAttempt`/per-attempt domain aggregate is introduced now. Both
  remain available for future ratification if a concrete trigger arises
  (e.g., quote revision/requote policy needing to distinguish superseding
  an already-answered RFQ from retrying an unanswered one; or provider
  message ID adoption making per-attempt tracking a real domain need).
  Not resolved by `RFQ-RT1`–`RFQ-RT5`. `RFQ-EH9` (`docs/decisions/
  ratified.md`) further restates, without adding a new trigger, that RFQ
  Event History's own historical send-attempt-result records are not a
  `SendAttempt` entity and do not resolve this item either.
- **Stuck-`SENDING` recovery** — how an RFQDispatch left in `SENDING`
  (e.g., after a provider timeout or a process crash mid-attempt) is
  eventually resolved to a terminal outcome (see `ratified.md`, `RFQ-S1`).
  `RFQ-RT4` (`docs/decisions/ratified.md`) additionally ratifies only that
  same-dispatch retry/reclaim of `SENDING` is not safe to treat as
  resolved until this separate recovery mechanism is decided — it does
  not itself define that mechanism. `RFQ-EP8` (`docs/decisions/
  ratified.md`) further ratifies only that real provider selection
  (Twilio SendGrid) does not, by itself, authorize `SENDING → SENT`,
  `SENDING → SEND_FAILED`, or `SENDING → retry` based on timeout, elapsed
  time, or human confidence alone — it likewise does not define the
  eventual recovery mechanism. `RFQ-EH6` (`docs/decisions/ratified.md`)
  additionally ratifies only that RFQ Event History does not resolve,
  narrow, or add any new guarantee to this same boundary — a local
  database write failure after a genuine provider acceptance still
  leaves the dispatch in `SENDING`, with no corresponding event
  recorded, exactly as before this family's introduction. `RFQ-EH6`'s
  own `UNKNOWN`-event recording semantics (now fully specified: an
  `UNKNOWN` outcome is itself a recorded historical event, in its own
  separate local transaction, never paired with a state transition that
  does not occur) likewise do not resolve this recovery mechanism —
  recording that an outcome was unknown is not the same as resolving it.
  `RFQ-EH10` (`docs/decisions/ratified.md`) similarly does not resolve
  this item — it ratifies only that the `SENT`/`SEND_FAILED` state
  transition takes precedence over, and does not roll back on, an Event
  History write failure; it says nothing about how a dispatch stuck in
  `SENDING` is ever resolved.
- **Provider timeout / unknown outcome handling** — the eventual recovery
  mechanism for a SEND attempt whose outcome could not be determined (see
  `ratified.md`, `RFQ-S1`); `RFQ-S1` ratifies only that such an attempt
  remains `SENDING`, not how it is later resolved.
- **Provider message ID / delivery confirmation** — the *existence* of an
  opaque provider message ID as a correlation primitive is now RATIFIED
  (see `ratified.md`, `RFQ-EP4`). Its meaning *within* RFQ Event History
  specifically — associable only with a historical successful-acceptance
  event, never delivery proof or an idempotency key — is now also
  RATIFIED (`RFQ-EH5`). Still OPEN: its exact field name/schema
  representation in `RFQDispatch` and in any future Event History table;
  delivery confirmation; bounce status capture.
- **Email provider selection** — **RESOLVED.** Twilio SendGrid is the
  selected real email provider for the initial RFQ outbound email
  integration, with an EU regional deployment configuration (EU subuser,
  EU API endpoint, EU dedicated IP, EU-region authenticated sending
  domain) ratified as a canonical deployment requirement (see
  `ratified.md`, `RFQ-EP1`, `RFQ-EP2`). The associated data-residency
  scope is narrowly ratified and explicitly non-absolute (see
  `ratified.md`, `RFQ-EP3`) — a broader enterprise/legal data-residency
  policy for YGT generally is a separate, still-open item (below). This
  is a documentation-only ratification: no provider SDK, credential,
  environment configuration, or adapter implementation exists in this
  repository as a result of it.
- **Provider idempotency key usage** — whether SendGrid offers a usable
  idempotency mechanism for *outbound send*, and whether/how one would
  ever be verified and integrated, is explicitly NOT assumed or ratified
  (see `ratified.md`, `RFQ-EP6`). Provider message ID (`RFQ-EP4`) is
  explicitly not equivalent to an idempotency key. **Disambiguation:**
  this is a distinct concern from inbound webhook event identity/dedup
  (`(provider, providerEventId)`), which is now RATIFIED at `RFQ-PD6` —
  the two sit on opposite sides of the send/delivery boundary and must
  never be conflated (see `RFQ-PD6`'s own Canonical separation block).
- **Webhook authenticity mechanism — RATIFIED AND IMPLEMENTED.** The
  verification *mechanism* (ECDSA signature, raw-body + timestamp
  signing, the two SendGrid headers, fail-closed policy on invalid
  verification, single-key configuration/management, and a 300-second
  replay-tolerance window as explicit application policy) was ratified
  at `RFQ-PD15`/`RFQ-PD16` (`docs/decisions/ratified.md`) and has now
  been implemented: `app/src/api/sendgridWebhookVerification.ts`
  (ECDSA verification over `timestamp + rawBody`, timestamp-freshness
  check, lazy verification-key loader) and the route-scoped raw-body
  handling in `app/src/api/server.ts`'s `POST /webhooks/sendgrid/events`
  (mounted before `express.json()` so the true raw bytes are preserved).
  Covered by `app/test/sendgridWebhook.test.ts` (valid/invalid signature,
  stale timestamp, tampered-body-with-valid-headers, missing headers).
  Still fully OPEN: where/how webhook event data is processed and
  stored BEYOND this verification+persistence step, including the
  US-staging caveat recorded at `RFQ-EP3`; any further bounce/
  complaint-event business handling beyond normalized persistence; and
  key rotation semantics, which `RFQ-PD16` explicitly declines to define
  beyond "no automated rotation, manual replacement only" (no rotation
  mechanism is implemented, consistent with that decision). None of
  `RFQ-EP1`–`RFQ-EP8` resolved any of this (see `ratified.md`,
  `RFQ-EP7`).
- **Provider Delivery & Outcome Confirmation Boundary —
  persistence/implementation — RATIFIED AND IMPLEMENTED.** `RFQ-PD1`–
  `RFQ-PD20` (`docs/decisions/ratified.md`) ratified the semantics in
  advance of implementation (delivery vs. send lifecycle separation,
  correlation contract via `custom_args.rfq_dispatch_id`,
  `UNCORRELATED`-event handling, provider event identity/dedup,
  delivery vocabulary and `BOUNCE`/`BLOCKED` subtyping, `UNKNOWN`/
  `DEFERRED` semantics, non-recovery of `SENDING` as a deliberate
  not-now position, no-automatic-retry, provider isolation, a dedicated
  (non-`RFQCommunicationEvent`) delivery-event model, event ordering,
  webhook authenticity mechanics, `custom_args` constraints and their
  explicit lifecycle-verification gap, no queue/worker, and
  delivery-is-not-receipt), following the same Fast Track pattern
  already used for `RFQ-EH1`–`RFQ-EH10`. The first production-shaped
  implementation slice now exists:
  - **Webhook endpoint:** `POST /webhooks/sendgrid/events`
    (`app/src/api/server.ts`), unauthenticated (no Principal/session —
    server-to-server), mounted before `express.json()`.
  - **Dedicated persistence model:** `RFQProviderDeliveryEvent`
    (`app/prisma/schema.prisma`; migration
    `20261007171921_add_rfq_provider_delivery_event`) — nullable
    `tenantId`/`rfqDispatchId`, `@@unique([provider, providerEventId])`
    (Postgres default NULLS DISTINCT, so a null `providerEventId` is
    never falsely deduplicated), deliberately excluded from
    `db/client.ts`'s `TENANT_SCOPED_MODELS` guard (a row may legitimately
    carry no tenant at all; documented in the schema comment).
  - **Mapping/correlation/persistence:**
    `app/src/services/providerDeliveryEventService.ts` — maps SendGrid's
    `event`/`type` onto the ratified closed vocabulary, extracts
    `rfq_dispatch_id` (flattened top-level key, with a defensive nested
    `custom_args.rfq_dispatch_id` fallback — see the unresolved shape
    question below), resolves tenant strictly from the matched
    `RFQDispatch` row (never from the payload), and persists idempotently
    (a duplicate `(provider, providerEventId)` is caught and treated as
    an already-recorded no-op).
  - **Outbound `custom_args` threading:** `EmailSender.send`'s
    `SendEmailInput` now carries an optional, provider-neutral
    `correlationId` (`app/src/api/emailSender.ts`);
    `rfqDispatchService.ts` passes the sending `RFQDispatch.id`;
    `sendgridEmailSender.ts` maps it onto
    `custom_args.rfq_dispatch_id` only when present.
  - **Tests:** `app/test/sendgridWebhook.test.ts` (24 tests: signature
    authenticity, correlation, dedup including a concurrent-race case,
    event-type mapping including `BOUNCE`/`BLOCKED`, lifecycle safety
    against `RFQDispatch`, cross-tenant isolation, `UNCORRELATED`
    diagnostic-only `providerMessageId` handling) and 2 new tests in
    `app/test/sendgridEmailSender.test.ts` for `custom_args` threading.

  Still fully OPEN, NOT closed by this implementation: any route/UI for
  surfacing provider delivery facts to a human (no read endpoint exists
  — only ingestion); the exact role/read-authorization policy such a
  future read endpoint would reuse (expected, by precedent, to mirror
  `RFQ-EH7`'s floor, but not itself decided here); and — unchanged from
  before — every item listed in the four bullets immediately below
  (`custom_args` real-provider lifecycle verification, `SENDING`
  reconciliation, `UNCORRELATED` investigation tooling, provider status
  lookup). This implementation has NOT been exercised against a real
  SendGrid account, credential, or webhook delivery — no such
  credential exists anywhere in this repository or environment; it is
  verified only against a locally generated test keypair standing in
  structurally for SendGrid's own signing mechanism.
- **`custom_args` full-lifecycle propagation — still unverified.**
  `RFQ-PD18` (`docs/decisions/ratified.md`) explicitly records that
  current official SendGrid documentation confirms `custom_args`
  echoing only for a `processed`-event example, not explicitly for
  `deferred`, `delivered`, `bounce`, `bounce`/`blocked`, or `dropped`.
  A webhook endpoint and correlation/mapping code now exist (see the
  bullet above), but no SendGrid credential exists anywhere in this
  repository or environment, so this remains exactly as unverified
  empirically as before implementation — only a locally generated test
  keypair and synthetic payloads have exercised the endpoint, never a
  real SendGrid-originated event. The implementation's own fail-safe
  behavior under this uncertainty (`RFQ-PD18`'s `UNCORRELATED`
  fallback: a flattened top-level `rfq_dispatch_id`, with a defensive
  but unverified nested `custom_args.rfq_dispatch_id` fallback) is
  exercised by `sendgridWebhook.test.ts`, but the underlying provider
  question itself remains open and would require a future credentialed
  integration test to close.
- **`SENDING` recovery via provider delivery evidence (future
  reconciliation)** — `RFQ-PD10` (`docs/decisions/ratified.md`) records
  this as a deliberate NOT NOW decision, not a permanent prohibition: no
  provider delivery event currently transitions a dispatch out of
  `SENDING`. Whether, and under what exact evidence/authority/
  idempotency rules, such a reconciliation mechanism should ever exist
  remains fully OPEN and would require its own separate future decision
  — restating and not narrowing the identical open position already
  held by `RFQ-EP8`/`RFQ-EH6`/`RFQ-EH10`.
- **`UNCORRELATED` provider event investigation tooling** — `RFQ-PD5`
  (`docs/decisions/ratified.md`) ratifies only that an uncorrelated event
  must never be auto-assigned a tenant or dispatch, and that a stored
  `providerMessageId`/`sg_message_id` relationship may be consulted as
  diagnostic metadata for manual human investigation. No such
  investigation tooling, query, or UI exists or is ratified — this
  remains fully OPEN.
- **`SEC-010` — Supplier authentication signal — V1 limitation
  explicitly ratified, control itself remains OPEN.** `RFQ-ATT1`
  (`docs/decisions/ratified.md`) now consolidates and names, as a
  citable floor, what `RFQ-R1` already disclaimed: the system makes no
  claim about the identity of the person or organization that
  submitted a Supplier Response, beyond `RFQ-R1`–`RFQ-R5`'s existing
  targeting/consumption/data-scope semantics; attribution remains
  `UNKNOWN`/not claimed, never a graded confidence value, and provider
  delivery evidence (`RFQ-PD1`–`RFQ-PD20`) must never be read as
  supplier identity or representative authority. `RFQ-ATT1` does
  **not** close `SEC-010` (`docs/security/enforcement-matrix.md`) —
  that control remains fully OPEN for any future stronger supplier
  attribution/authentication mechanism, which would require its own
  separate, future semantic/domain decision if a concrete trigger
  arises (a security incident, higher-risk procurement scope, legal/
  compliance or contractual requirement, or explicit business need).
  No supplier portal, login, identity verification, representative-
  authorization mechanism, or attribution-confidence schema field is
  introduced or designed by `RFQ-ATT1` — all remain exactly as open as
  before this entry.
- **Enterprise/legal data residency policy for YGT (general)** — whether
  YGT requires a stronger, absolute data-residency guarantee than the
  capability-level configuration ratified at `RFQ-EP2`/`RFQ-EP3`; this is
  a business/legal decision, not resolved by this family or by
  `RFQ-PD1`–`RFQ-PD20`.
- **RFQ Communication & Response Event History — persistence/
  implementation** — `RFQ-EH1`–`RFQ-EH10` (`docs/decisions/ratified.md`)
  now RATIFY the semantics in advance of implementation (purpose/
  non-authority, minimum recordable event scope, retry/resend
  representation, data boundary, `providerMessageId`'s in-history
  meaning, append-only/transactional discipline, the tenant/read-
  authorization floor, domain-specific actor/source classification,
  `SendAttempt` deferral, and — as of `RFQ-EH10` — the precedence of
  the `SENT`/`SEND_FAILED` state transition over its own corresponding
  Event History write), following the same Fast Track pattern already
  used for `RFQ-S1`/`RFQ-S2` and `RFQ-R1`–`RFQ-R5`. Still fully OPEN:
  every implementation detail — the exact table/column design, the
  exact service function(s), the exact route/UI (if any), the exact
  role set permitted to read it (only the tenant-bound/authenticated
  floor is ratified, per `RFQ-EH7`), the exact actor/source field
  representation (`RFQ-EH8`), and any missing-Event-History-record
  recovery/reconciliation mechanism (`RFQ-EH10` explicitly does not
  ratify one — see the new bullet immediately below). The
  read-authorization boundary's *floor* is RATIFIED (`RFQ-EH7`: reuse of
  the application's existing established workflow read-authorization
  policy, no new role/permission taxonomy) — but the *exact* existing
  role/policy to reuse is not itself re-derived or re-selected by this
  family and remains an implementation-time lookup, not a newly invented
  decision point. No table, migration, or code exists for this yet.
- **Event History missing-record recovery/reconciliation** — whether,
  and how, a missing Event History record (e.g., following the write
  failure scenario `RFQ-EH10` explicitly declines to resolve) is ever
  detected, backfilled, or reconciled. `RFQ-EH10` (`docs/decisions/
  ratified.md`) ratifies only that such a failure never rolls back or
  otherwise affects the already-committed, authoritative `RFQDispatch`
  state — it does not ratify any recovery/reconciliation mechanism for
  the history record itself. Remains fully OPEN; requires its own
  separate future decision if a concrete need arises.
- **Broader audit/event-sourcing scope (deferred)** — a universal
  `AuditLog` entity; Approval/PurchaseOrder audit; ERP audit; AI/agent
  audit; a retention policy; a legal/compliance retention framework; a
  cross-domain event bus; a generic event-sourcing architecture. All are
  explicitly named as Non-Goals by `RFQ-EH1`–`RFQ-EH10` (`docs/decisions/
  ratified.md`) and remain fully OPEN — each would require its own
  separate future ratification if a concrete trigger arises, per `U3`'s
  own domain-specific-enforcement guardrail.
- **Quote resubmission/requote/versioning** — whether a supplier may
  submit more than one response/quote version for the same RFQDispatch or
  SourcingEvent (cross-referenced from the existing `QuoteVersion`
  schema comment; not previously registered in this document).
- **Allocation (cross-DecisionPackage aggregate)** — `DP-3`
  (`docs/decisions/ratified.md`) ratifies only that no `Allocation`
  domain entity is introduced now, and records three explicit triggers
  under which this is reopened: cross-decision quantity invariant
  (Trigger A), combined approval (Trigger B), and revision/current-plan
  semantics (Trigger C). None of the three triggers, and none of the
  policy questions they would require (multi-supplier allocation
  business policy, MOQ, undercoverage/overcoverage, supplier
  substitution, one-Approval-many-PO, combined-approval workflow
  mechanics, requote/revision mechanics, DecisionPackage supersession
  mechanism), is resolved by `DP-1`–`DP-3` — all remain OPEN exactly as
  before.
- **Future Execution Authority (`B2`) design** — the concrete design/
  implementation of Execution Authority itself remains unaddressed; `B2`
  ratifies only that it is conceptually distinct from Approval/
  Capability/Tenant Binding and currently unimplemented.

## D-5 — Explicit invalidation/cancellation mechanism

**Status: `D5-R1 RATIFIED (D-5.14) — NOT-REVERSIBLE / PERMANENT. D5-R2
(successor traceability) is now OPEN.`**

**Historical note, preserved rather than deleted:** this D-5 root question
was previously recorded here as fully OPEN (no selection among Model A /
Model B / Model C / any hybrid) from D-5 through D-5.13. As of **D-5.14**,
a human has explicitly ratified the root question (reframed by D-5.9/D-5.10
as the binary **D5-R1**, superseding the earlier three-way A/B/C framing —
see `docs/analysis/D-5-cancellation/README.md` for why Model C collapsed
into a downstream policy rather than remaining an independent root option)
as **NOT-REVERSIBLE / PERMANENT**. The full ratified decision record,
including exact semantic meaning and source basis, is at
`docs/decisions/ratified.md` (D5-R1) and
`docs/decisions/D-5-ratification-package.md`.

- **What remains OPEN within the D-5 family:**
  - **D5-R2 — Successor Traceability:** when a new business action is
    created after a previous business action was permanently cancelled,
    must the new action explicitly link to its cancelled predecessor?
    This is now the active open question — see
    `docs/decisions/D-5-ratification-package.md` for its full record. It
    is not resolved here, and neither "traceability is required because
    useful" nor "traceability is unnecessary because R1 is permanent" is
    assumed.
- **What is now INACTIVE (not ratified, not rejected — simply
  non-applicable under the ratified branch):** D5-R3 (reversal Authority)
  and D5-R4 (reversal propagation), both of which presupposed reversal
  exists.
- The full analytical history remains archived in
  `docs/analysis/D-5-cancellation/README.md` (covering D-5 through
  D-5.14). That archive remains analysis and ratification history, not a
  substitute for the ratified decision record itself.
- `SEC-022` (Cancellation/invalidation enforcement, see
  `docs/security/enforcement-matrix.md`) may now be scoped against the
  ratified permanent-cancellation model, though this document does not
  itself perform that enforcement-design work — SEC-022 remains OPEN as
  an implementation task, no longer blocked on an unratified root
  question.
- The DERIVED P1/P2 relationship set in `derived.md` remains valid and
  usable unchanged — this ratification does not touch it.

This section will be updated again only on a further explicit human
ratification event (e.g., resolving D5-R2), never by silent inference.
