# Document 04 — Security Model (Baseline)

Status: **RATIFIED baseline principles**, with a number of specific
enforcement points explicitly left **OPEN / DESIGN GAP** rather than
presented as implemented. See `docs/security/enforcement-matrix.md` for the
per-control register (SEC-001 through SEC-025).

This document records security-relevant architectural principles at the
baseline level. It does not describe implementation status of any specific
control beyond what is stated here or cross-referenced to the enforcement
matrix.

## Ratified security principles

- **AI is never authoritative.** No AI/LLM component's output is treated as
  a source of truth for authorization, commercial fact, or state transition
  without passing through deterministic validation and, where required,
  human authorization.
- **AI-facing components (referred to in prior analysis as "Z2") have zero
  DB credential.** AI-facing components cannot connect to the database
  directly under any role — this is a hard architectural boundary, not a
  least-privilege DB role restriction.
- **Schema validation plus deterministic validation** is required on all
  AI-produced output before it can influence business state — schema
  conformance alone is not sufficient; business-rule/deterministic
  validation runs afterward.
- **Consequential mutation requires independent authorization** — a
  mutation with real business consequence (e.g., sending an RFQ, creating a
  PO, transmitting to the ERP) must be authorized through a check that is
  independent of whatever component requested the mutation.
- **Core-controlled mutation** — only Procurement Core's controlled service
  layer may mutate authoritative state; no direct external or AI-driven
  writes to authoritative tables.
- **AI never directly accesses the ERP.** All ERP interaction is mediated
  by the adapter boundary (Principle 16) and controlled services.
- **Supplier-originated content (email, quotes, RFQ responses, documents) is
  untrusted input** — it is evidence to be validated and extracted from, not
  a trusted command or fact source.
- **UNKNOWN remains UNKNOWN.** A security-relevant fact that cannot be
  established with sufficient evidence is represented as UNKNOWN, never
  silently defaulted to a permissive or convenient value.
- **RFQ / PO / ERP writes are human-authorized in the MVP** unless a
  specific automation of that authorization has been separately and
  explicitly ratified. Absent such a ratification, the default is human
  authorization.
- **Prepare != transmit.** Preparing a consequential action (e.g.,
  assembling a PO for send) and actually transmitting it externally are
  distinct steps with distinct authorization/gating requirements — a
  preparation step passing does not imply the transmit step is
  pre-authorized.
- **Immutable / versioned commercial artifacts.** Certain commercial
  records (Approval, Quote versions, PO once sent) are immutable or
  append-only once created — see `03-data-model.md`.
- **Idempotency != correctness.** An idempotent operation is safe to retry
  without duplicating effect, but idempotency alone does not establish that
  the operation's content or authorization was correct — these are separate
  properties and must not be conflated.
- **One-tenant execution.** Every execution context is bound to exactly one
  tenant; no execution spans multiple tenants' data or authority.
- **Audit / export authorization** is itself a controlled, authorized
  action — access to audit trails and data export is not unrestricted even
  for otherwise-privileged roles.
- **Memory exclusions** — certain categories of data are excluded from
  AI/ProcurementMemory persistence; the exact exclusion list is an
  enforcement-level detail tracked in the enforcement matrix (SEC-015),
  **OPEN** where not yet fully specified.
- **Integration error sanitization** — errors surfaced from ERP/external
  integrations are sanitized before being shown to AI components or
  external-facing surfaces, to avoid leaking internal system details.
  Exact mechanism: **OPEN** (SEC-016).
- **AI tool entity/tenant match** — any AI tool invocation that references
  an entity must be checked for tenant match against the execution context
  before acting. Exact enforcement mechanism: **OPEN** (SEC-018).
- **Runtime tool allowlists** — AI components operate against an explicit
  allowlist of permitted tools/actions per context, not an open-ended action
  space. Exact allowlist mechanism: **OPEN** (SEC-019).
- **Dual control for security-control weakening** — any action that weakens
  an existing security control (e.g., broadening a permission, disabling a
  check) requires a distinguishable, audited, and — per prior analysis —
  likely dual-control authorization. Exact mechanism: **OPEN** (tracked as
  R9 in `decisions/ratified.md`/`decisions/open.md`).
- **Minimum ERP credential scope** — ERP integration credentials are scoped
  to the minimum permission set required, not broad administrative access.
- **Cancellation/reissue authorization remains OPEN** where not yet
  ratified — see `docs/analysis/D-5-cancellation/README.md`. This document
  does not assert any cancellation/reversal authorization model.
- **Tenant-partitioned future indexes** — any future search/index
  infrastructure is expected to be tenant-partitioned; not yet designed.
- **Tenant-scoped logs** — logs are scoped/filterable by tenant and are
  themselves subject to the audit/export authorization principle above.

## Explicit non-claims

This document does **not** claim any of the above principles are fully
enforced in code — it records baseline security principles, not
implementation or enforcement status. Enforcement status per control is
tracked separately, and exclusively, in
`docs/security/enforcement-matrix.md`; several controls are explicitly
`OPEN` or `DESIGN GAP` there, and others are implemented — that matrix,
not this document, is authoritative on which. This document also does not
select or ratify any cancellation/reversal mechanism (see
`docs/analysis/D-5-cancellation/`).
