# Document 03 — Data Model Baseline

Status: **RATIFIED architecture baseline.** This document records
architecture-level data-model decisions established in prior analysis. It is
**not an implementation schema** — no DDL, no exact column lists, no ORM
models are specified here. Where the prior analysis did not go further than
an architectural property, this document stops at the same point rather than
inventing implementation detail.

## Identity and tenancy

- Primary keys use **ULIDs**.
- `tenant_id` is **mandatory** on all customer-scoped tables.
- Foreign keys that cross tenant-scoped tables are **composite tenant FKs**
  (i.e., include tenant_id as part of the FK relationship), not bare
  entity-id FKs, to make cross-tenant reference structurally harder to
  construct by accident.
- All timestamps are stored in **UTC**.

## Lifecycle / mutability rules

- Master data uses **soft delete**.
- **Hard delete** is permitted only for a zero-child **DRAFT**
  ProcurementRequest — i.e., only for a request that has not yet produced any
  dependent records and has not left the draft state.
- Certain DB roles carry **immutability/versioning** obligations at the
  role level (see `docs/decisions/ratified.md` for the five-role DB
  privilege taxonomy referenced in prior analysis: core application/service
  role, append-only writer role, projection writer role, AI-facing
  components with zero DB connectivity, and migration/admin role).
- **Optimistic concurrency** is used on mutable authoritative entities.
- **Enums** are used for code-coupled state machines (i.e., states that
  application code branches on directly).
- **Reference tables** are used for configurable taxonomies (i.e., value
  sets that are data, not code).
- **Centralized, atomic** projections are maintained for
  ProcurementRequest/SourcingEvent-level aggregate views, rather than
  computed ad hoc at each read site.
- **One active SourcingEvent per Request Line** — at most one
  currently-active SourcingEvent may exist for a given Request Line at a
  time (**RATIFIED — RL-C3**; see `docs/decisions/ratified.md`). This
  constrains active-state concurrency only; it does not establish lifetime
  one-to-one cardinality, re-sourcing rules, cancellation/re-sourcing
  behavior, or successor-lineage semantics, all of which remain **OPEN**.

## Supplier model

- **Supplier relationship classification** is an independent axis with
  values: `NEW`, `EXISTING`, `HISTORICAL`, `UNKNOWN`.
- Supplier identifiers carry a materialized **`is_verified_strong`** flag,
  derived from whether the identifier is of a strong identifier type and has
  passed verification — not asserted directly by any single source.

## Evidence model

- Commercial facts are captured through an **evidence / claim model**: raw
  evidence is captured, AI extraction is attempted against it, and the
  result becomes a structured claim subject to validation before being
  treated as a persisted fact (see `docs/decisions/ratified.md` R11).

## Quote / decision model

- Quotes are **versioned**; each `quote_version` is **immutable** once
  created.
- **DecisionPackage** carries these states: `DRAFT`, `GENERATED`,
  `PRESENTED`, `SUPERSEDED`, `EXPIRED`, with an associated
  **FRESH / STALE** semantic distinguishing whether a presented package still
  reflects current underlying data.
- The linkage between a DecisionPackage and the quote version(s) it presents
  is **immutable** once established.

## Approval model

- **Approval is INSERT-only.** No approval decision row is ever updated or
  deleted once created (see `M2` in `docs/decisions/ratified.md`).
- There is **no persisted PENDING approval row** — a pending approval
  request is not itself represented as an Approval record; only an actual
  decision (approve/reject) is recorded as an Approval.
- An Approval references a **frozen DecisionPackage** — i.e., the specific,
  immutable state of the DecisionPackage that was presented at the time of
  the decision, not a live/mutable reference.

## Purchase order / ERP model

- A **PurchaseOrder is immutable once SENT.**
- ERP-side state is separated into a distinct **`erp_sync_record`**
  construct, keeping ERP transaction/posting/fulfillment state
  architecturally separate from Procurement Core's own PO record — this is
  the data-model expression of the Core/ERP authority split described in
  `00-canonical-baseline.md`.
- **Idempotency and reconciliation** are required properties of the
  ERP-sync boundary — exact reconciliation schedule/scope is **OPEN** (see
  `docs/decisions/open.md`).

## Audit and configuration

- **`audit_event` / `procurement_event`** are append-only.
- **`policy_config`** is a mutable pointer to the currently-active policy,
  while each **`policy_version`** it can point to is immutable once created
  — this separates "what policy is active now" (mutable pointer) from "what
  did a given policy version actually say" (immutable, historical).
- **`procurement_memory`** is derived data — it is not treated as an
  independent source of truth, and is subject to the memory-exclusion and
  freshness-metadata principles in `01-system-principles.md` and
  `docs/decisions/ratified.md` (R8).
- **Inbound email** is treated as untrusted input, consistent with
  `01-system-principles.md` principle 11.

## DB-role separation

- DB access is separated by role, consistent with the five-role taxonomy
  referenced above. **AI-facing components have zero DB credential** under
  any role — this is repeated here because it is a data-model-boundary
  consequence, not only a security principle (see
  `04-security-model.md`).

## Product Identity and Historical Context — Data Model Boundary

This section records only domain-boundary facts already ratified
elsewhere; it does not define any new entity, field, cardinality, query
model, or persistence mechanism. `docs/architecture/02-domain-model.md`
remains the authoritative source for the underlying domain semantics —
this section exists only to state, briefly, what is and is not yet
decided at the data-model level.

- **ProductOrServiceReference** is the canonical Core product/service
  identity concept (RATIFIED — R2). Its internal structure — identity
  object vs. reference/pointer, product/service subtype, lifecycle,
  versioning — is **not defined here** and remains an evidence/modeling
  gap (see `02-domain-model.md` §6.1).
- **Customer material code / SKU** is a reference to canonical product
  identity and is **not itself** canonical product identity (RATIFIED —
  PI-C5). One canonical product **may** be associated with multiple
  customer material codes/SKUs. Exact cardinality, uniqueness, mutability,
  lifecycle, and related constraints remain **OPEN**.
- **Supplier identity and `ProductOrServiceReference` identity are
  distinct concepts** — this preserves R3 exactly and introduces no new
  relationship or mapping structure.
- **Manufacturer, MPN, and Brand are not canonical product
  identity-defining by themselves** (RATIFIED — PI-C2). Any
  product-to-manufacturer relationship, product-to-brand relationship, MPN
  mapping, storage fields, or cardinalities remain **OPEN**.
- **Packaging variation does not automatically create a different
  canonical product** (RATIFIED — PI-C6). Packaging variants **may** be
  associated with distinct customer material codes/SKUs and distinct
  historical price contexts. This does **not** define or imply a
  `PackagingVariant` entity, a persistence structure, a cardinality, a
  query model, or a price-history-per-packaging schema — all remain
  **OPEN**.
- **Historical purchase facts are derived from immutable qualifying PO
  records** — the existing `PurchaseOrder`-immutable-once-SENT rule above
  already constitutes the authoritative historical source (RATIFIED —
  PI-C9). No `HistoricalPurchase` entity, snapshot table, or duplicate
  purchase-history storage is created or implied by this statement.
- **Historical non-PO supplier quotes remain represented by the existing
  immutable Quote/QuoteVersion history** and are distinct from the
  PO-derived purchase-price trend (RATIFIED — PI-C9). **Cross-SourcingEvent
  retrieval/query semantics remain undecided** — this section does not
  state, and no other part of this document states, that prior quotes can
  already be retrieved across SourcingEvents.
- **Request quantity/unit, supplier quote quantity/unit, pricing unit, and
  PO quantity/unit are independent commercial data points** (RATIFIED —
  PI-C8). No canonical unit, conversion rule, conversion table,
  normalization mechanism, or line cardinality is defined or implied here.

## Explicit scope limits

This document is an **architecture baseline**, not an implementation
schema. It does not specify: exact table/column names beyond what is named
above, exact index definitions, exact constraint syntax, or a complete
entity-relationship diagram. Row-Level Security (RLS) as an *additional*
enforcement mechanism on top of service-layer authorization remains
**OPEN** (see R10 in `docs/decisions/open.md`). No cancellation/reversal
data-model construct is specified here — see
`docs/analysis/D-5-cancellation/README.md` for why that remains OPEN.
