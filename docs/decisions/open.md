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
- **RFQ resend/retry policy** — whether an RFQDispatch already `SENT`,
  `SEND_FAILED`, or `RESPONDED` may be sent/resent again, and under what
  conditions.
- **Stuck-`SENDING` recovery** — how an RFQDispatch left in `SENDING`
  (e.g., after a provider timeout or a process crash mid-attempt) is
  eventually resolved to a terminal outcome (see `ratified.md`, `RFQ-S1`).
- **Provider timeout / unknown outcome handling** — the eventual recovery
  mechanism for a SEND attempt whose outcome could not be determined (see
  `ratified.md`, `RFQ-S1`); `RFQ-S1` ratifies only that such an attempt
  remains `SENDING`, not how it is later resolved.
- **Provider message ID / delivery confirmation** — whether and how
  provider-level transmission evidence (e.g., a message id, delivery/
  bounce status) is captured.
- **Email provider selection** — which outbound email provider/service is
  used, and the associated trust/data-residency implications.
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
