# Ratified Decision Register

Status: **RATIFIED.** Every decision in this register has been explicitly
approved by a human in prior architecture-analysis conversation. They are
recorded here canonically for the first time in this repository, without
reinterpretation or expansion. Reopening any of these requires an explicit
human decision, not a documentation edit.

## Domain / architecture decisions

### R1
RFQ is modeled as `SourcingEvent + RFQDispatch × N` — one SourcingEvent can
fan out to multiple RFQDispatch records (e.g., one per supplier contacted).

### R2
`ProductOrServiceReference` is canonical within Procurement Core; ERP-side
product/service mappings are external to that canonical reference, not a
replacement for it.

### R3
Supplier identity resolution is **staged**; no silent fuzzy merges of
supplier records are performed automatically.

### R4
Procurement Core holds **commercial authority**; the ERP holds
**transaction/fulfillment authority** — restated here from
`00-canonical-baseline.md` because it is also a ratified domain decision, not
only a framing statement.

### R5
`User ↔ TenantMembership ↔ Tenant` is a many-to-many relationship.

### R6
Multi-currency support is **mandatory**, not a future enhancement.

### R7
No autonomous recurring generation (i.e., the system does not autonomously
regenerate/re-trigger procurement workflows on a recurring basis without an
explicit initiating action).

### R8
`ProcurementMemory` carries **freshness metadata** and must never be
presented to a user or downstream consumer as if it were current data
without that metadata being visible/considered.

### R9
Control-weakening admin actions must be authorized, auditable, and
distinguishable from ordinary actions. **The exact mechanism remains OPEN**
(see `open.md`) — only the requirement itself is ratified.

### R10
Service-layer authorization is the **primary** enforcement mechanism;
database-level controls (e.g., RLS) are, at most, defense-in-depth.
**Whether RLS is adopted at all remains OPEN** (see `open.md`).

### R11
Evidence pipeline, ratified shape:

```
Source
  → CapturedEvidence
  → AI Extraction
  → StructuredClaim
  → Validation
  → PersistedClaim
```

### R12
Confidence never substitutes for evidence — a high AI confidence score does
not itself justify treating an unvalidated claim as a persisted fact.

### R13
Cost efficiency is a **constitutional** concern — i.e., it is treated as a
first-class architectural constraint, not an afterthought optimization.

### R14
Agents are **logical capabilities**, not necessarily a 1:1 mapping to
individual LLM calls — an "agent" in this system's vocabulary may be
implemented as multiple calls, a single call, or a non-LLM deterministic
step, as long as it fulfills the logical capability.

### R15 — SEC-012 Runtime Tenant Guard (Defense-in-Depth Mechanism)

**Statement:** Service-layer tenant enforcement (the existing pattern of
every tenant-scoped service function requiring and applying an explicit
`tenantId`) remains the **primary** enforcement mechanism, consistent with
`R10`. In addition, the authoritative tenant context — sourced from the
authenticated `Principal.tenantId` (`AUTHN-6`/`AUTHN-7`) — will be carried,
explicitly, into a tenant-bound Prisma client/extension layer that provides
a runtime defense-in-depth backstop for tenant-scoped Prisma operations,
addressing `SEC-012` (`docs/security/enforcement-matrix.md`).

This mechanism:

- fails closed if no tenant context is supplied to it;
- fails closed if a tenant-scoped operation lacks the required tenant
  scope;
- fails closed if a query's tenantId does not match the authoritative
  tenant context;
- does not apply to models explicitly outside tenant scope per the
  current Prisma schema — `Tenant`, `ExternalIdentity`, and `Session`
  carry no `tenantId` column (see `03-data-model.md`) and are not
  retroactively treated as tenant-scoped by this decision;
- performs its enforcement check deterministically against the query's
  own arguments/context, without issuing any additional Prisma/database
  query of its own;
- is not solely dependent on HTTP request context as its carrier — the
  design must allow explicit `tenantId` propagation into future non-HTTP
  execution contexts (background workers, the future ERP machine
  identity class of `AUTHN-8`), exactly as today's explicit service-layer
  parameters already do;
- does not use AsyncLocalStorage or any other implicit request/execution-
  context propagation as its mechanism — that approach is not ratified by
  this decision;
- does not select, adopt, or reject Row-Level Security — `RLS`'s own OPEN
  status (`open.md`) is unchanged by this decision;
- does not extend automatic enforcement to raw SQL (`$queryRaw`/
  `$executeRaw`) — none exists in the repository as of this ratification;
  any future raw SQL use requires its own, separate security control, not
  assumed to be covered here.

**Scope:** Ratifies only the architectural *shape* of the SEC-012
backstop — that it exists, that service-layer enforcement remains
primary, and the explicit constraints above. Does not ratify an exact
Prisma extension API, helper/factory naming, file structure, extension
registration details, or transaction implementation details — those
remain implementation choices made within this decision's boundaries.

**Explicit non-decisions:** Does not modify `Principal` (`AUTHN-6`), API
tenant binding (`AUTHN-7`, `assertTenantMatches`), or any existing
service-layer function signature. Does not resolve `RLS`, `R9`, or any
other OPEN item. Does not implement Execution Authority or any ERP
identity model.

**Relationship to R10:** This decision operationalizes `R10`'s already-
ratified "service-layer primary, database-level controls at most
defense-in-depth" principle — it does not supersede or reinterpret `R10`.

**Evidence:** Explicit human ratification via conversation, following two
independent read-only technical assessments of `SEC-012` (enforcement-
mechanism comparison, and exact tenant-context-propagation analysis),
2026-10-06.

## Authorization semantics

### M2
Approval is a **historical, tenant-level authorization decision** — it is
**not** continuously renewable personal authorization. Once made, an
Approval decision is a fact about what was authorized at that time, not an
ongoing personal grant that must be kept "current" by the approving
individual.

### B2
**Execution Authority is separate from Approval.** An Approval does not
itself grant execution authority, transmission authority, ERP write
authority, or external communication authority. Execution Authority is
evaluated independently, at the point where an action is actually executed.

### C — Authority and Capability are separate
These are distinct semantic concepts:

- **Authority** — is this actor/component normatively permitted to perform
  this operation in this context?
- **Capability** — does this actor/component technically possess the means
  to perform it?

**Canonical distinction, ratified:**

> Approval ≠ Execution Authority ≠ Capability ≠ Tenant Binding

Authentication is also distinct from all of the above.

## U3 — Shared Authority Concept, Domain-Specific Implementation

**Exact ratified semantics:**

Authority and Capability are **shared conceptual vocabulary** across the
system's domains. Sharing the vocabulary does **not** imply:

- a universal Authority table;
- a universal authorization service;
- a universal `authorize()` API;
- a universal policy engine;
- a universal persisted policy object;
- a universal audit event shape;
- a universal temporal model.

Each domain retains its **own**:

- Authority semantics;
- Capability semantics;
- temporal semantics;
- enforcement mechanism.

**Any new identity/domain introduced into the system must explicitly map:**

1. Authority
2. Capability
3. Tenant Binding
4. Temporal semantics
5. Enforcement boundary

### U3 Guardrails (ratified, verbatim in substance)

1. No canonical Authority entity.
2. Domain-specific enforcement unless explicitly ratified otherwise.
3. Temporal semantics remain domain-specific.
4. Tenant Binding remains orthogonal to Authority/Capability.
5. Capability remains orthogonal to Authority.
6. No generic `authorize()` abstraction by default.
7. New identity/domain requires explicit semantic mapping before it can rely
   on Authority/Capability vocabulary.
8. No shared audit representation by default.

These guardrails are binding on any future design: a design that introduces
a universal Authority mechanism, collapses Capability into Authority,
collapses Tenant Binding into either, or assumes a shared audit
representation without explicit ratification is **inconsistent with U3** as
ratified.

## D5-R1 — Cancellation Reversibility (Root) — NOT-REVERSIBLE / PERMANENT

**Ratified in D-5.14.** Full source analysis: D-5 through D-5.13 in
`docs/analysis/D-5-cancellation/README.md`; full decision record with
options, rationale, and dependency structure:
`docs/decisions/D-5-ratification-package.md`.

**Exact ratified semantic meaning:**

- P1 business cancellation is **permanent** for the original
  business-action identity.
- Once P1 cancellation occurs, the original business action **can never
  become operative again**.
- A later continuation of the underlying business need is represented as
  a **new, distinct business-action identity**, not a revival of the
  original one.
- That new business action must follow the **applicable existing
  authorization/approval lifecycle** — no reduced or shortcut
  authorization path is introduced by this decision.
- **Historical cancellation remains immutable historical truth** —
  nothing about this decision mutates, deletes, or reinterprets a
  cancellation fact once recorded.
- **No reversal fact, reversal event, or reversal mechanism is part of
  the ratified model.** D5-R3 (reversal Authority) and D5-R4 (reversal
  propagation) are therefore inactive, not ratified in either direction.

**Basis:** explicit human ratification (D-5.14), informed by — but not
equivalent to or derived from — the independent architectural
recommendation in D-5.13. The recommendation is supporting analysis; the
human ratification is the decision's authority.

**What remains open as a result:** D5-R2 — successor traceability (does a
later replacement business action need to link back to its cancelled
predecessor?). See `docs/decisions/open.md` and
`docs/decisions/D-5-ratification-package.md`. This and all other D-5-
adjacent deferred questions (DecisionPackage reuse, SourcingEvent reuse,
PO/ERP retransmission behavior, R9/dual-control, changed-commercial-terms
policy, reversal ordering mechanism — now moot) are **not** resolved by
this ratification.

## Product Identity Domain Decisions (PI-C1–PI-C11)

**Naming note:** these decisions are referred to as "C1"–"C11" in the
conversation and analysis history that produced them (the Domain Identity
Discovery / Ratification Candidate Extraction sequence). They are recorded
here with the prefix **PI-** (Product Identity) to avoid confusion with
the already-ratified decision named plainly **C** above (Authority and
Capability are separate) — "C1" and "C" are different strings, but the
visual similarity is close enough to risk misreading, so this document
uses `PI-C1`–`PI-C11` as the canonical IDs while preserving "C1"–"C11" as
the informal shorthand already used elsewhere (e.g.
`docs/architecture/02-domain-model.md`). This follows the same
grouped-prefix convention already established by `D5-R1`/`D5-R2`, rather
than inventing a new scheme.

Full source analysis: `docs/architecture/02-domain-model.md` (Sections
6–19) and the Domain Identity Discovery / Ratification Candidate
Extraction audit sequence. Each decision below is a **principle-level**
ratification only. None of them ratifies a database schema, entity,
cardinality, index, algorithm, or persistence mechanism — those remain
tracked as OPEN items in `docs/decisions/open.md` unless a decision's own
scope note says otherwise.

### PI-C1 — Category-Specific Product Identity
Product identity is **category-specific**. There is no single universal
fixed identity-attribute list that applies identically to every
product/service category. Identity-defining attributes must be evaluated
according to the relevant category/domain definition.

**Does NOT ratify:** the category taxonomy, the exact attribute-set data
model, attribute value types, attribute-set versioning, effective dating,
configuration ownership/administration, or deterministic matching
implementation. These remain OPEN.

### PI-C2 — Non-Identity of Manufacturer / MPN / Supplier / Supplier SKU / Brand
Manufacturer, manufacturer part number (MPN), supplier, supplier SKU, and
brand are **not**, by themselves, canonical product identity-defining
attributes. Changing manufacturer alone does not create a different
canonical product when the applicable identity-defining specification
remains identical. Brand and manufacturer information may still be
displayed as informational/commercial metadata.

**Does NOT ratify:** Product↔Manufacturer cardinality, Product↔Brand
cardinality, MPN mapping structures, supplier SKU mapping structures, or
supplier-specific commercial relationships. These remain OPEN where not
already defined.

### PI-C3 — Specification Change Creates a Distinct Product When Identity-Defining
If a specification attribute that is identity-defining for the relevant
category changes, the resulting item is a **different canonical product**
(e.g., material grade, dimensions, thickness, diameter, tolerance, surface
finish, technical standard, technical/performance specification, or other
category-defined identity attributes, where those attributes are
identity-defining for that category). This principle is category-dependent
— it does not mean every attribute change creates a new canonical product;
packaging, weight, unit, and country of origin remain subject to
category/context semantics (see PI-C6, PI-C8).

**Does NOT ratify:** product revision/supersedes/replaced-by lineage. This
remains OPEN.

### PI-C4 — Dual Authorship of Category Identity Definitions
YGT may provide prepared category/identity-attribute structures, **and**
the customer/domain expert may define or customize category-specific
identity definitions. This is a business-level authorship principle. AI
must not independently establish authoritative identity definitions —
this follows from the existing evidence/authority principles (R12,
AI-not-authoritative) and does not create a new AI authority model.

**Does NOT ratify:** the technical mechanism for configuration, ownership,
authorization, versioning, effective dating, conflict resolution,
inheritance, or global-vs-tenant-specific reference data. These remain
OPEN.

### PI-C5 — Customer Material Code / SKU Is Distinct from Canonical Product Identity
A customer's internal material code/SKU is **not** equivalent to the
canonical product identity. A single canonical product may be associated
with multiple customer material codes/SKUs. Customer codes are references
to the canonical product, not the canonical identity itself. Packaging
differences may result in different customer material codes/SKUs while
still referring to the same canonical product when packaging is not
identity-defining for that category.

**Does NOT ratify:** exact cardinality constraints, uniqueness
constraints, code lifecycle, code mutability, archival/replacement
behavior, packaging↔customer-code cardinality, or exact database
representation. These remain OPEN.

### PI-C6 — Packaging Variation Does Not Automatically Change Canonical Product
A packaging variation does not, by itself, create a different canonical
product; packaging is category/context-dependent. Two packaging variants
may refer to the same canonical product while having different customer
material codes/SKUs, separate commercial/price histories, and separately
filterable historical context. Business UX preference: current
packaging/material history is presented first, while other packaging
variants of the same canonical product remain separately
accessible/filterable.

**Does NOT ratify:** `PackagingVariant` as a mandatory entity,
packaging↔canonical-product cardinality, packaging↔customer-code
cardinality, the exact persistence model, or whether all packaging
histories are always shown together or separately. These remain OPEN.

### PI-C7 — Procurement Conditions Are Not Product Identity
MOQ, lead time, payment terms, Incoterms, and delivery location are
procurement/commercial conditions, **not** product identity-defining
attributes. They belong to the procurement/quote/commercial context
rather than canonical product identity.

**Does NOT ratify:** their exact domain entities, cardinalities,
persistence model, or lifecycle. These remain OPEN.

### PI-C8 — Request / Quote / Pricing / PO Quantity and Unit Are Independent
Request quantity/unit, supplier quote quantity/unit, pricing unit, and PO
quantity/unit are **independent** commercial data points and must not be
silently collapsed into one universal quantity/unit representation. Unit
semantics are category/context-dependent; a unit may participate in
product identity for some categories only when the category definition
explicitly makes it identity-relevant, but unit is not universally
identity-defining.

**Does NOT ratify:** unit conversion authority, normalization algorithms,
conversion source, canonical unit model, or exact persistence structure.
These remain OPEN.

### PI-C9 — Purchase-Price Trend vs. Historical Supplier Quote Context
Historical purchase-price trend is based **only** on purchases that
actually resulted in approved/issued/completed PO records (per the
eventual authoritative purchase lifecycle). Supplier quotes that did not
result in a PO are **excluded** from the historical purchase-price trend
calculation. For the current calendar year: purchases are shown by
quarter (Q1–Q4), with all relevant purchases in the quarter shown first,
followed by the quantity-weighted average price for that quarter. For
prior calendar years: an annual average based on qualifying historical
purchases. Non-PO supplier quotes are **not** included in trend
calculations, but must not be treated as if they do not exist — they may
be shown separately as **Historical Supplier Quote Context**, kept
semantically distinct from (a) the current validated quote, (b) historical
purchase prices, (c) historical non-PO quotes, and (d) the overall
canonical-product historical purchase trend. Historical supplier quote
context must never contaminate the historical purchase-price trend.

**Does NOT ratify:** exact unit-normalization mechanism, cross-unit
comparison algorithm, exact annual/quarterly aggregation implementation,
treatment of abnormal/outlier purchases, exact storage model, or exact
supplier-history query implementation. These remain OPEN.

### PI-C10 — False Positive and False Negative Matching Are Both Critical
Both of the following are critical business failures: (1) showing
historical information from a materially different product as if it
belonged to the current product, and (2) failing to surface genuinely
relevant historical information for the current product. Matching must
not be optimized solely for recall or solely for precision while ignoring
the other.

**Does NOT ratify:** the exact matching algorithm, thresholds, scoring, or
implementation. These remain OPEN.

### PI-C11 — Manual History Search Is Distinct from Automatic Identity Matching
Manual History Search is a capability separate from automatic
canonical-product historical association; a user may explicitly search
historical procurement records to investigate related/different products.
Manual search does not itself redefine canonical product identity, and
does not convert semantic similarity, textual similarity,
supplier-declared equivalence, SKU similarity, or MPN similarity into
authoritative canonical identity. AI may assist discovery/suggestion, but
authoritative identity remains governed by the existing Core/evidence/
authority principles (R12, AI-not-authoritative — not re-ratified here).

**Does NOT ratify:** the manual-search UX, search filters, ranking,
similarity thresholds, semantic-search implementation, or
historical-context persistence model. These remain OPEN.

## Request / Line / Sourcing Domain Decisions (RL-C1–RL-C4)

**Dependency note (factual, not a ranking):** RL-C1 → RL-C2 → RL-C3 form a
dependency chain — RL-C2 presupposes RL-C1 (independent sourcing per line
requires lines to exist), and RL-C3 presupposes RL-C2 (a per-line
concurrency rule requires the per-line sourcing structure RL-C2
establishes). **RL-C4 is independent of RL-C1/RL-C2/RL-C3** and carries no
dependency relationship to them. No score, priority, importance, or
superiority is assigned to any of the four.

### RL-C1 — Multi-line ProcurementRequest

**Statement:** A ProcurementRequest may contain multiple distinct
product/service lines. Request Line is therefore a genuine business
concept.

**Evidence:** BC-1, explicit business clarification.

**Scope:** Confirms Request Line as a genuine business concept. Confirms
that one ProcurementRequest may contain multiple distinct product/service
lines.

**Explicit non-decisions:** exact schema; PK/FK structure;
`ProductOrServiceReference` ↔ RequestLine relationship; minimum/maximum
line count; RequestLine lifecycle; Quote Line existence/structure; PO Line
existence/structure. None of these may be inferred from RL-C1.

### RL-C2 — Independent Line-Level Sourcing

**Statement:** Each Request Line is sourced through its own independent
SourcingEvent. A single SourcingEvent does not span multiple distinct
Request Lines within the same ProcurementRequest.

**Evidence:** BC-2, explicit business clarification. Compatible with and
non-contradictory of R1.

**Scope:** Establishes structural independence of sourcing per Request
Line. Preserves R1 exactly: one SourcingEvent may fan out to multiple
RFQDispatch records/suppliers.

**Explicit non-decisions:** exact RequestLine ↔ SourcingEvent persistence
relationship; lifetime cardinality; re-sourcing of the same Request Line;
cancellation/re-sourcing interaction; D5-R2 successor-lineage semantics;
quote cardinality; split sourcing; Quote Line / PO Line structure. None of
these may be inferred from RL-C2.

### RL-C3 — One Active SourcingEvent Per Request Line

**Statement:** At most one currently-active SourcingEvent may exist for a
given Request Line at a time.

**Evidence:** BC-2 business intent. Resolves the previously explicit scope
gap in the existing "one active SourcingEvent" wording (`03-data-model.md`).

**Critical semantic boundary:** RL-C3 governs **only** concurrent
active-state cardinality. It does **not** mean: exactly one SourcingEvent
for the lifetime of a Request Line; immutable one-to-one RequestLine →
SourcingEvent history; automatic re-sourcing; permission to create a new
SourcingEvent after cancellation; cancellation reversal; successor
lineage; or D5-R2 resolution.

**Explicit conceptual cases:**
1. One active SourcingEvent on Line A → allowed.
2. Two simultaneously active SourcingEvents on Line A → not allowed.
3. One terminal + one active SourcingEvent on Line A → **not decided
   here**; lifecycle/re-sourcing remains OPEN.
4. Line A and Line B each having an active SourcingEvent simultaneously →
   allowed, and consistent with RL-C2.

**Explicit non-decisions:** lifetime cardinality; historical number of
SourcingEvents per Request Line; re-sourcing; cancellation/re-sourcing
interaction; reversal; successor lineage; D5-R2. None of these may be
inferred from RL-C3.

### RL-C4 — Partial Quote

**Statement:** A supplier may quote a quantity smaller than the requested
quantity; such a quote is not inherently invalid. Its validity is
determined by applicable commercial/business rules.

**Evidence:** BC-3, explicit business clarification. Compatible with
PI-C8.

**Scope:** Establishes only that quoted quantity may be smaller than
requested quantity without making the quote inherently invalid.

**Explicit non-decisions:** whether the quote is commercially acceptable;
MOQ rules; stock rules; automatic validity criteria; approval; PO
quantity; supplier combination; split sourcing; automatic PO splitting;
Quote Line structure; PO Line structure; unit conversion/normalization.

**A partial quote MUST NOT be interpreted as:** automatic approval,
automatic PO creation, automatic split sourcing, automatic supplier
combination, or automatic PO splitting.

## Quantity Semantics Domain Decisions (QS-C1–QS-C2)

**Naming note:** these decisions follow the same grouped-prefix convention
already established by `PI-C1`–`PI-C11`, `RL-C1`–`RL-C4`, and `D5-R1`/
`D5-R2` — `QS-` (Quantity Semantics) distinguishes this family from those
already in use. They originate from the Q1/Q2/Q3 Human Ratification
Preparation package (Quantity Semantics — Q1/Q2/Q3), itself built on the
Partial Fulfillment & Quantity Semantics Domain Decomposition Audit and
the Selected Quantity & Commercial Selection Semantic Boundary Audit.
**Dependency note:** QS-C2 presupposes QS-C1 (it authorizes a quantity
that only exists as a concept because of QS-C1) but does not alter QS-C1
in any way.

### QS-C1 — Selected Quantity Is a Distinct Business Concept

**Statement:** Selected Quantity is the quantity that the procurement
decision-maker chooses to pursue from a supplier quote or, if
multi-supplier combination is later ratified, from one or more supplier
quotes. It is conceptually distinct from Quoted Quantity, which
represents the quantity stated by the supplier.

**Evidence:** explicit human ratification of Q1 (ACKNOWLEDGE), informed by
the single-supplier over-quote scenario (Requested=100, Quoted=120,
Selected=100) and under-quote scenario (Requested=100, Quoted=60,
Selected=40), both of which require a value distinguishable from
Requested Quantity and Quoted Quantity using only currently-ratified
vocabulary (PI-C8, RL-C4). Also informed by RL-C4's own foreclosure
language ("MUST NOT be interpreted as automatic supplier combination,
automatic split sourcing, or automatic PO splitting"), which presupposes
a non-automatic act for "automatic" to contrast against.

**Scope:** Establishes only the existence of Selected Quantity as a named
business concept, semantically distinct from Quoted Quantity. Does not
modify, reinterpret, or extend PI-C8 or RL-C4 — both remain exactly as
previously ratified.

**Explicit non-decisions:** any database field, column, table, or entity;
QuoteLine; PO Line; allocation; DecisionPackage schema or persistence
location; quantity conversion/normalization; multi-supplier combination
(D1); who/what may construct a selection, human or system-assisted (D2);
whether Selected Quantity may differ from Quoted Quantity in either
direction (D3); coverage acceptance policy (D6); shortfall/remaining-
quantity resolution (D4); SourcingEvent re-sourcing lifecycle (D5, RL-C3
case 3); commercial suitability of a combination (D7); whether Approval
authorizes Selected Quantity exactly or may authorize a different
quantity — **now settled by QS-C2 below**; whether Ordered Quantity must
equal the quantity Approval authorizes (Q3, still OPEN); Approval→PO
cardinality; DecisionPackage→PO cardinality; fulfillment-quantity
semantics; or any AI authority to determine Selected Quantity. None of
these may be inferred from QS-C1.

### QS-C2 — Approval Authorizes Selected Quantity As Represented

**Statement:** Approval authorizes the Selected Quantity exactly as
represented in the frozen DecisionPackage. Approval does not create an
independent Approved Quantity business concept merely by occurring.

**Semantic boundary:**

```
Requested Quantity → Quoted Quantity → Selected Quantity → Approval
```

- **Requested Quantity** — quantity requested by the procurement
  request/line.
- **Quoted Quantity** — quantity stated by the supplier in its quote.
- **Selected Quantity** — quantity the procurement decision-maker chooses
  to pursue from a supplier quote, as established by QS-C1.
- **Approval** — historical, tenant-level authorization (M2) of the
  frozen DecisionPackage, including the Selected Quantity represented in
  that frozen package.
- There is no separate Approved Quantity business fact created solely
  because Approval occurs. Approval does not act as a commercial
  redrafting operation that independently changes the Selected Quantity.
  If a decision-maker wants a different quantity, that is **not resolved
  by this decision** — it remains subject to whatever future
  revision/new-decision mechanism is eventually ratified.

**Evidence:** explicit human ratification of Q2 (Model X), prepared via
the Q2 Selected Quantity vs Approved Quantity Human Ratification
Preparation package. Consistent with, and does not reinterpret, M2
(Approval as a historical, INSERT-only, tenant-level authorization fact),
B2 (Execution Authority separate from Approval), and the existing
"frozen DecisionPackage" language in `03-data-model.md` (Approval
references the specific, immutable DecisionPackage state presented at
decision time) — QS-C2 clarifies only the quantity semantics of that
already-ratified authorization boundary; it does not extend "frozen" to
mean anything beyond what `03-data-model.md` already states.

**Relation to existing decisions:** builds on QS-C1 without altering it.
Does not reinterpret PI-C8 (quantity/unit independence remains exactly as
ratified). Does not modify M2 (Approval remains INSERT-only and
historical, not a mutable quantity record) or B2 (Execution Authority
remains separate from, and unaffected by, this decision).

**Explicit non-decisions:** whether Selected Quantity may be lower than
Requested Quantity; whether Selected Quantity may exceed Requested
Quantity; whether a partial selection is permitted; whether multiple
suppliers may be combined (D1); who/what may construct a selection (D2);
quantity-divergence policy between Quoted and Selected (D3); undercoverage
resolution (D4); re-sourcing/subsequent-SourcingEvent behavior (D5,
RL-C3 case 3); exact/under/over coverage acceptance (D6); commercial
suitability of quantity contributors (D7); QuoteLine semantics; PO Line
semantics; quantity allocation; Approval→PO cardinality;
DecisionPackage→PO cardinality; PO quantity semantics; Ordered Quantity
semantics (Q3, still OPEN); Fulfilled Quantity semantics; ERP quantity
semantics; unit conversion; or the persistence/schema representation of
Selected Quantity, including whether it must be persisted independently
or only represented inside another authoritative artifact. None of these
may be inferred from QS-C2. QS-C2 does not imply that future PO
quantities must automatically equal the Selected/authorized quantity,
that Ordered Quantity is thereby defined, that PO creation is thereby
authorized, or that ERP/fulfillment quantity must equal it — each remains
a separate future decision.

## Approval ↔ PurchaseOrder Domain Decisions (APO-D1–APO-D4)

**Naming note:** these decisions follow the same grouped-prefix convention
already established by `PI-C1`–`PI-C11`, `RL-C1`–`RL-C4`, `QS-C1`–`QS-C2`,
and `D5-R1`/`D5-R2` — `APO-` (Approval ↔ PurchaseOrder) distinguishes this
family from those already in use, and in particular from the pre-existing
bare `D-1`–`D-6` items in `docs/decisions/open.md`, which are unrelated.
The informal shorthand `D1`–`D7` used in the originating atomic
decomposition analysis (Approval ↔ PurchaseOrder — Atomic Semantic
Decomposition) is preserved as each entry's cross-reference, exactly as
"C1"–"C11" was preserved alongside `PI-C1`–`PI-C11`. Only `D1` (of the
seven decomposed dimensions D1–D7) is ratified here as `APO-D1`; `D2`,
`D3`, `D4`, `D5`, `D6` (Q3), and `D7` remain unratified and are addressed,
if at all, only in their own separate future ratification packages.

### APO-D1 — Approval → PurchaseOrder Existence Gate

**Statement:** A PurchaseOrder may only exist/be created after a valid
Approval for the relevant frozen decision exists. This establishes an
Approval → PurchaseOrder temporal/existence gate.

**Evidence:** explicit human ratification (D1 = YES), from the Approval ↔
PurchaseOrder D1–D4 Human Ratification Package.

**Scope:** Establishes only the existence-gate relationship above.
Approval remains exactly as previously ratified: a historical
authorization fact (M2), INSERT-only, linked to a frozen DecisionPackage,
distinct from Execution Authority (B2). PurchaseOrder remains exactly as
previously ratified: a Core commercial-decision-level artifact, distinct
from ERP transaction/posting/fulfillment state (R4, `03-data-model.md`),
immutable once SENT.

**Explicit non-decisions:** whether Approval is the normative
authorization basis for the act of creating a PurchaseOrder — **now
settled by APO-D2 below**; whether PurchaseOrder is the commercial
realization of the approved decision (`D3`, still unratified); whether a
PurchaseOrder must explicitly reference the Approval that authorized it
(`D4`, still unratified); whether Approval constrains PO commercial
content (`D5`, still OPEN); the Selected Quantity ↔ PO Quantity
relationship (`D6` / Q3, still OPEN); whether Approval authorizes
transmission/execution (`D7`, still OPEN); any PO cardinality; any
Approval→PO, DecisionPackage→PO, RequestLine→PO, QuoteVersion→PO, or
SourcingEvent→PO cardinality or structural relationship; PO revision; PO
cancellation/reissue; ERP retransmission; Fulfillment Quantity; Remaining
Quantity; or Allocation. **APO-D1 does not mean PO creation is
automatically triggered by Approval** — it establishes only the
prerequisite, not the creation mechanism. **APO-D1 does not mean Approval
itself grants Execution Authority or transmission authority** — B2 and
Principle 15 remain exactly as previously ratified. None of these may be
inferred from APO-D1.

### APO-D2 — Approval as Normative Authorization Basis for PurchaseOrder Creation

**Statement:** Approval constitutes the normative authorization basis for
the consequential act of creating the corresponding PurchaseOrder.
Approval provides the normative basis for the PO creation operation.

**Evidence:** explicit human ratification (D2 = YES), from the Approval ↔
PurchaseOrder D1–D4 Human Ratification Package.

**Scope:** Approval remains exactly as previously ratified: a historical
authorization fact (M2), INSERT-only, associated with a frozen
DecisionPackage, distinct from Execution Authority (B2). PurchaseOrder
remains exactly as previously ratified: a Core commercial-decision-level
artifact, separate from ERP transaction/posting/fulfillment state,
immutable once SENT. **APO-D1 remains independently ratified** — APO-D1
and APO-D2 are not merged into a single decision; they remain separately
identifiable semantic commitments (APO-D1: a valid Approval must exist
before the PO may exist/be created; APO-D2: Approval is the normative
basis for the act of creating that PO).

**Explicit non-decisions:** APO-D2 does not mean Approval = Execution
Authority; does not mean Approval = Capability; does not mean Approval
automatically triggers PO creation; does not mean Approval automatically
authorizes PO transmission; does not mean Approval automatically
authorizes ERP execution; does not mean Approval automatically authorizes
all PO commercial content; does not establish Selected Quantity = PO
Quantity; does not establish any PO Quantity transformation rule; does
not establish any PO cardinality; does not establish any
DecisionPackage→PO, RequestLine→PO, QuoteVersion→PO, or SourcingEvent→PO
cardinality or relationship. Whether PurchaseOrder is the commercial
realization of the approved decision (`D3`), whether a PurchaseOrder must
explicitly reference the Approval that authorized it (`D4`), whether
Approval constrains PO commercial content (`D5`), the Selected Quantity ↔
PO Quantity relationship (`D6` / Q3), and whether Approval authorizes
transmission/execution (`D7`) all remain exactly as before — unratified
or OPEN. Principle 15 and B2 remain exactly as previously ratified. None
of these may be inferred from APO-D2.

## PurchaseOrder Content Relationship Decisions (CR-A, CR-B.1–CR-B.2, CR-C, CR-D1–CR-D2, SC-1, Q3, Q3-CV)

**Naming note:** these decisions follow the same grouped-prefix convention
already established by `PI-C1`–`PI-C11`, `RL-C1`–`RL-C4`, `QS-C1`–`QS-C2`,
`APO-D1`–`APO-D2`, and `D5-R1`/`D5-R2` — `CR-` (Content Relationship)
distinguishes this family from those already in use. The informal
shorthand `CR-A`/`CR-B`/`CR-D1`/`CR-D2`/`CR-E` used in the originating
atomic decomposition analyses (Pre-APO-D3 Content Relationship Audit;
Pre-APO-D3 Atomic Ratification Readiness Audit) is preserved as each
entry's cross-reference; `CR-B.1` and `CR-B.2` subdivide the `CR-B`
("Content Correspondence") shorthand into its two separately-ratified
components (existence of a correspondence relationship, and its
strength). `CR-C` is a new entry in this same family — not a new
independent prefix — recording a boundary-clarifying decision rather than
a further subdivision of `CR-B`: it defines what counts as the "approved
decision" that `CR-A`'s provenance and `CR-B.1`/`CR-B.2`'s correspondence
are measured against, as distinct from pre-freezing AI recommendations.
`CR-D1`, `CR-D2` (found in the readiness audit to substantially overlap
with `D5` rather than stand as an independent item), and `CR-E` (found in
the same audit to be negative-space rather than a genuine standalone
commitment, recommended to remain deferred) remain unratified and are
addressed, if at all, only in their own separate future ratification
packages. **Dependency note:** `CR-B.1` and `CR-B.2` presuppose `CR-A` (a
correspondence relationship, and its strength, are only meaningful once a
provenance relationship exists) but
do not alter `CR-A` in any way.

### CR-A — PurchaseOrder Content Provenance

**Statement:** The decision-relevant commercial content of a
PurchaseOrder must derive from the approved decision represented in the
frozen DecisionPackage and authorized by Approval. This establishes a
normative content-provenance relationship:

```
Frozen DecisionPackage → Approved Decision → Approval →
PurchaseOrder commercial content
```

The PurchaseOrder's decision-relevant commercial content is not an
independently originated commercial decision detached from the approved
decision.

**Evidence:** explicit human ratification (CR-A = YES), from the CR-A
Human Ratification Recording.

**Scope:** Establishes only the normative content-provenance relationship
above. Does not modify, reinterpret, or extend APO-D1 (existence gate),
APO-D2 (normative creation authority), QS-C1 (Selected Quantity as a
distinct concept), or QS-C2 (Approval authorizes Selected Quantity as
represented) — all four remain exactly as previously ratified.

**Explicit non-decisions:** the exact field-level scope of
"decision-relevant commercial content"; whether every PO field must
derive from the DecisionPackage; the exact transformation mechanism, if
any (`CR-D1`); whether transformation is normatively permitted (`CR-D2`,
substantially overlapping with `D5`); whether PO content must remain
equal to DecisionPackage content — **now settled in principle by CR-B.1
and CR-B.2 below, subject to their own field-level scope boundary**; the
Selected Quantity → PO Quantity relationship (`D6` / Q3, still OPEN);
Approval ↔ PurchaseOrder structural traceability (`D4`, still unratified);
PurchaseOrder transmission/execution authority (`D7`, still OPEN);
PurchaseOrder cardinalities or lifecycle relationships; whether
PurchaseOrder is the commercial realization of the approved decision
(`APO-D3`, still unratified); whether and how Approval normatively
constrains PurchaseOrder content (`D5`, still OPEN); and any supplier,
ERP, or external-system execution semantics. None of these may be
inferred from CR-A.

### CR-B.1 — PurchaseOrder Content Correspondence

**Statement:** PurchaseOrder content must carry a normative correspondence
relationship with the approved decision represented in the frozen
DecisionPackage and authorized by Approval. In addition to the provenance
relationship ratified in CR-A, the PurchaseOrder's applicable
decision-bearing commercial content must be consistent with the approved
decision.

**Evidence:** explicit human ratification (CR-B.1 = YES), from the CR-B.1
+ CR-B.2 Ratification.

**Scope:** Establishes only that a normative correspondence relationship
exists, in addition to (not instead of) CR-A's provenance relationship.
Does not modify, reinterpret, or extend CR-A, APO-D1, APO-D2, QS-C1, or
QS-C2 — all remain exactly as previously ratified.

**Explicit non-decisions:** the exact field-level scope of "applicable
decision-bearing commercial content" to which correspondence applies
(addressed only in part by CR-B.2's strength statement, still OPEN at the
field level); whether transformation exists or is permitted (`CR-D1`,
`CR-D2`/`D5`); the Selected Quantity → PO Quantity relationship (`D6` /
Q3, still OPEN); Approval ↔ PurchaseOrder structural traceability (`D4`,
still unratified); PurchaseOrder transmission/execution authority (`D7`,
still OPEN); PurchaseOrder cardinality, splitting, or multi-supplier
execution; CR-E or any "PO content independently determined" semantics;
whether PurchaseOrder is the commercial realization of the approved
decision (`APO-D3`, still unratified). None of these may be inferred from
CR-B.1.

### CR-B.2 — Correspondence Strength (Exact, Scoped)

**Statement:** The correspondence ratified in CR-B.1 is of **EXACT**
strength, but only as applied to the **applicable decision-bearing
commercial content** carried from the approved decision into the
PurchaseOrder. This does **not** mean: that all PurchaseOrder fields must
be identical to the DecisionPackage; that technical metadata must be
equal; or that PO-specific technical fields (PO number, internal ID,
timestamps, ERP references, transmission identifiers) must equal
anything in the DecisionPackage. Exact equality applies only within the
scope of "applicable decision-bearing commercial content" — a scope this
decision does not itself define.

**Evidence:** explicit human ratification (CR-B.2 = EXACT, scoped), from
the CR-B.1 + CR-B.2 Ratification.

**Scope:** Establishes only the strength (exact, within an as-yet-undefined
scope) of the correspondence relationship CR-B.1 establishes exists. Does
not define that scope. Does not modify CR-A, CR-B.1, APO-D1, APO-D2,
QS-C1, or QS-C2.

**Explicit non-decisions:** which PO fields fall within "applicable
decision-bearing commercial content" — **the classification test is now
settled by `SC-1` below; no closed field enumeration exists, and applying
the test to any specific field remains a separate, unratified exercise**;
whether DecisionPackage → PurchaseOrder transformation exists (`CR-D1`,
still OPEN); the transformation mechanism, if any; whether transformation
is normatively permitted (`CR-D2` / `D5`, still OPEN); the Selected
Quantity → PO Quantity relationship (`D6` / Q3, still OPEN); Approval ↔
PurchaseOrder structural traceability (`D4`, still unratified);
PurchaseOrder transmission/execution authority (`D7`, still OPEN); PO
cardinality/splitting/multi-supplier execution; CR-E semantics; whether
PurchaseOrder is the commercial realization of the approved decision
(`APO-D3`, still unratified); whether Approval is Execution Authority
(explicitly not established — B2 remains exactly as previously
ratified). None of these may be inferred from CR-B.2.

### CR-C — Decision Formation vs. PurchaseOrder Transformation Boundary

**Statement:** Two stages are semantically distinct and must not be
conflated:

```
Stage 1 — Decision Formation
Supplier Quotes → AI Analysis/Recommendation →
Human Decision Formation/Revision → Frozen DecisionPackage → Approval

Stage 2 — Approved Decision → PurchaseOrder
Frozen DecisionPackage → Approval → PurchaseOrder
```

An AI Recommendation is not an approved decision. Commercial content
proposed by AI (e.g., supplier, quantity, price) may be changed, selected,
or revised by the human decision-maker during Stage 1, before that
decision is frozen into the DecisionPackage and authorized by Approval.
Such a change — for example, an AI recommendation of 100 units revised by
the human decision-maker to 90 units, with the 90-unit decision then
frozen and approved — is **not** a PurchaseOrder transformation, is
**not** an Approved Decision → PurchaseOrder transformation, and does
**not** mean the AI Recommendation must be identical to the frozen
approved decision. Once the human-formed decision is frozen in the
DecisionPackage and authorized by Approval, it becomes the approved
decision that CR-A's provenance and CR-B.1/CR-B.2's exact correspondence
are measured against — e.g., a frozen approved decision of 90 units
corresponds, under CR-B.1/CR-B.2, to a PurchaseOrder of 90 units; the
AI's earlier 100-unit recommendation is not relevant to that
correspondence. Stage 1's human decision formation/revision is **not**
the same transformation relationship as the Stage 2 Approved Decision →
PurchaseOrder relationship governed by `CR-D1` (still unratified).

**Evidence:** explicit human ratification, from the Human-Ratified
Decision Formation / PO Transformation Boundary documentation task.

**Scope:** Establishes only the conceptual boundary between Stage 1
(Decision Formation, ending at Approval) and Stage 2 (Approved Decision →
PurchaseOrder, governed by `CR-A`/`CR-B.1`/`CR-B.2`). Does not modify,
reinterpret, or extend CR-A, CR-B.1, CR-B.2, APO-D1, APO-D2, QS-C1, or
QS-C2 — all remain exactly as previously ratified.

**Explicit non-decisions:** whether a transformation relationship exists
between the approved decision and the PurchaseOrder — **now settled in
principle by CR-D1 below**; the mechanism of any such transformation;
whether any such transformation is limited to representation/format
changes or also covers other kinds of change; whether any such
transformation is normatively permitted (`CR-D2` / `D5`, still OPEN); the
Selected Quantity ↔ PO Quantity relationship (`D6` / Q3, still OPEN);
Approval ↔ PurchaseOrder structural traceability (`D4`, still
unratified); PurchaseOrder transmission/execution authority; PurchaseOrder
cardinality, splitting, or multi-supplier execution; `CR-E`; whether
PurchaseOrder is the commercial realization of the approved decision
(`APO-D3`, still unratified); and any separate governance rules for which
commercial decision areas an AI recommendation may address or influence.
None of these may be inferred from CR-C.

### CR-D1 — PurchaseOrder Content Transformation / Mapping Relationship

**Statement:** The approved decision represented in the frozen
DecisionPackage and the PurchaseOrder have a defined transformation/
mapping relationship.

**Interpretation boundary:** CR-D1 establishes only the **existence** of a
transformation/mapping relationship between the approved decision and the
PurchaseOrder. This does **not**, by itself: authorize commercial-content
changes; define the transformation mechanism; define transformation
granularity; define which PO fields are transformed; permit deviation
from CR-B.2's EXACT correspondence (for the applicable decision-bearing
commercial content CR-B.2 covers); resolve Selected Quantity → PO
Quantity (`D6`/Q3); resolve Approval ↔ PO traceability (`D4`); establish
transmission/execution authority (`D7`); establish PO cardinality; or
establish whether a transformation requires a new DecisionPackage,
revision, re-approval, or another control.

**Critical semantic distinction:** "A transformation relationship exists"
is not the same as "the commercial decision may be changed."
Representation/format/field/ERP-specific mapping may fall within the
scope of this transformation relationship. Any commercially consequential
transformation remains subject to later normative decisions — in
particular `D5` / the normative-permission question previously identified
as the `CR-D2` concept — plus the separate quantity decisions (`D6`/Q3).

**Evidence:** explicit human ratification (CR-D1 = YES), from the CR-D1
Human Ratification — PurchaseOrder Content Transformation/Mapping task.

**Scope:** Establishes only the existence of a transformation/mapping
relationship. Does not modify, reinterpret, or extend CR-A, CR-B.1,
CR-B.2, CR-C, APO-D1, APO-D2, QS-C1, or QS-C2 — all remain exactly as
previously ratified.

**Explicit non-decisions:** the transformation mechanism; transformation
granularity; which PO fields are subject to transformation; whether
transformation is normatively permitted and under what conditions —
**now settled in part by CR-D2 below, for representational/technical
transformations only; commercial transformation permission remains
OPEN**; the Selected Quantity → PO Quantity relationship (`D6` / Q3,
still OPEN); Approval ↔ PurchaseOrder structural traceability (`D4`,
still unratified); PurchaseOrder transmission/execution authority (`D7`,
still OPEN); PurchaseOrder cardinality, splitting, or multi-supplier
execution; `CR-E`; whether PurchaseOrder is the commercial realization of
the approved decision (`APO-D3`, still unratified); and whether any
transformation requires a new DecisionPackage, revision, re-approval, or
other control. None of these may be inferred from CR-D1.

### CR-D2 — Representational/Technical Transformation Permission

**Naming disambiguation (important, read before use):** this decision was
human-ratified under the working label **`D5-A`**. That label is **not**
used as this entry's canonical ID, because `D5`/`D-5` already names a
different, long-established, independently ratified decision family in
this repository — the cancellation/invalidation-lifecycle track (`D5-R1`
RATIFIED NOT-REVERSIBLE/PERMANENT, `D5-R2` OPEN successor traceability,
`D5-R3`/`D5-R4` inactive; see `docs/decisions/open.md` and the `D5-R1`
entry above). That family has no relationship whatsoever to PurchaseOrder
content transformation. Separately, `D5` has also been used informally,
throughout the `CR-A`/`CR-B.1`/`CR-B.2`/`CR-C`/`CR-D1` entries above, as
shorthand for the open question "does Approval normatively constrain
PurchaseOrder content" — itself distinct from the cancellation `D5-R`
family, and itself the same territory the earlier atomic-decomposition
audits called `CR-D2`. To avoid a three-way collision between (a) the
ratified cancellation `D5-R` family, (b) the informal PO-content-
constraint `D5` shorthand, and (c) this new decision's human-assigned
`D5-A` label, this decision is recorded under **`CR-D2`** — continuing
the existing `CR-` grouped-prefix family (per the same disambiguation
precedent already used for `PI-C1`–`PI-C11` versus the bare decision `C`)
— with `D5-A` preserved here as the informal/human-given label, exactly
as `C1`–`C11` was preserved alongside `PI-C1`–`PI-C11`. **No decision
named `D5-A`, `D5-B`, `D5-C`, `D5-D`, or `D5-E` is created, and the
cancellation `D5-R1`/`D5-R2` family is untouched by this naming choice.**

**Statement:** Representational, formatting, identifier-mapping,
normalization, or ERP/supplier-specific technical transformations that do
not change the decision-bearing commercial meaning of the approved
decision represented in the frozen DecisionPackage and authorized by
Approval are normatively permitted to be applied during PurchaseOrder
creation.

**Permitted examples (illustrative, not exhaustive):** piece → EA or
another equivalent technical unit representation where commercial meaning
is unchanged; Core supplier identity → ERP/vendor identifier mapping;
Core product/reference → ERP or supplier reference mapping; date/time
representation normalization; address normalization; ISO/ERP-specific
technical representations; other equivalent technical/representational
mappings that do not alter decision-bearing commercial meaning.

**Critical boundary:** CR-D2 establishes permission only for
transformations that preserve the decision-bearing commercial meaning of
the approved decision. **CR-D2 does NOT authorize commercial
transformation.** Examples outside CR-D2, remaining OPEN for separate
normative decisions: 90 → 80 units; €10 → €9.50 price; Net 30 → Net 45;
DAP → FOB; or changing any other decision-bearing commercial term.

**Relationship to CR-B.2:** CR-D2 must be read together with CR-B.2 —
"exact correspondence" under CR-B.2 concerns the applicable
decision-bearing commercial content and does not require byte-identical
technical representation; CR-D2 clarifies that representational/technical
difference, within the bounds stated above, is compatible with CR-B.2's
exact-correspondence requirement.

**Evidence:** explicit human ratification (`D5-A` = YES, recorded here as
`CR-D2`), from the D5-A Human Ratification — Representational/Technical
Transformation Permission task.

**Scope:** Establishes only normative permission for non-commercial,
representational/technical transformation, as bounded above. Does not
modify, reinterpret, or extend CR-A, CR-B.1, CR-B.2, CR-C, CR-D1, APO-D1,
APO-D2, QS-C1, or QS-C2 — all remain exactly as previously ratified. Does
not modify, reinterpret, or extend D5-R1 or D5-R2 (the unrelated
cancellation family) in any way.

**Explicit non-decisions:** commercial transformation permission (remains
OPEN); the commercial-change mechanism; whether a commercial change
requires a new/revised DecisionPackage; whether a new Approval is required
after a commercial change; the Selected Quantity → PO Quantity
relationship (`D6` / Q3, still OPEN); PO pre-SENT manual modification
semantics; PurchaseOrder cardinality; Approval ↔ PurchaseOrder structural
traceability (`D4`, still unratified); transmission/execution authority
(`D7`, still OPEN); and the final field-level scope of all
decision-bearing commercial content (the test for this is now `SC-1`
below; no closed enumeration is created). No `D5-B`, `D5-C`, `D5-D`, or
`D5-E` decision is created or resolved by this entry. None of these may
be inferred from CR-D2.

### SC-1 — Decision-Bearing Commercial Content Classification Rule

**Statement:** A semantic commercial concept — not a database field,
schema column, UI field, or transaction-specific recorded value — is
decision-bearing commercial content for purposes of CR-B.2 if and only
if, by design of the commercial/decision model rather than by what
happens in a particular transaction:

1. **Primary-input status:** it is not itself computed, via a fixed known
   rule, from other decision-bearing commercial concepts; it is a free
   parameter of the commercial bargain; **and**
2. **Inter-party obligation status:** a different value for that concept
   would change what the buyer or seller is obligated to provide,
   deliver, perform, pay, or receive as between the contracting parties,
   rather than merely changing how one party internally executes,
   routes, labels, records, calculates, or administers an already-fixed
   obligation.

**Important semantic boundaries:** The rule classifies semantic
concepts, not physical schema fields. Classification is based on the
concept's designed role in the commercial/decision model, not on whether
a human manually entered it, whether it was defaulted, whether it was
selected by a business rule, whether it was overridden in a particular
transaction, or where/how it is persisted. A derived/calculated
consequence remains derived according to its designed semantic role even
if a particular transaction permits or contains a manual override — any
governance of such an override is a separate question and is **not**
decided by SC-1. The rule distinguishes decision-bearing commercial
content from technical/metadata, derived/calculated, contextual/
reference, and operational/execution content where applicable, without
creating a closed field list.

**Evidence:** explicit human ratification, from the independent review
and adversarial validation of the SC-1 classification rule.

**Scope:** Establishes only the classification test itself. Does not
modify, reinterpret, or extend CR-A, CR-B.1, CR-B.2, CR-C, CR-D1, CR-D2,
APO-D1, APO-D2, QS-C1, or QS-C2 — all remain exactly as previously
ratified.

**Explicit non-decisions:** whether any decision-bearing commercial
content may be commercially transformed after Approval — **the narrow
same-Approval question is now settled by `CT-A1` below (NOT PERMITTED);
whether a different commercial outcome may ever be authorized by some
other mechanism (`CT-A2`) and how any such mechanism would be governed
(`CT-B`) remain OPEN**; the Selected Quantity → PO Quantity relationship — **now settled
at the economic-quantity-correspondence level by `Q3` below; the
permission/governance questions `Q3` itself leaves open remain exactly as
`Q3` states**; supplier substitution permission; quote/quote-version
substitution permission; PurchaseOrder pre-SENT edit permissions;
Approval ↔ PurchaseOrder structural traceability (`D4`, still
unratified); PO cardinality; governance or authorization of manual
overrides of derived values; and any specific future schema design. No
closed field enumeration is created or implied. None of these may be
inferred from SC-1.

### Q3 — Selected Quantity ↔ PurchaseOrder Quantity (Economic Correspondence)

**Statement:** The PurchaseOrder's decision-bearing commercial quantity
content must carry **exact correspondence**, in terms of **economic
quantity**, with the Selected Quantity authorized by Approval in the
frozen DecisionPackage.

**Economic quantity, defined:** "economic quantity" is the actual amount
of goods/services the transaction obligates the parties to transfer —
not the raw numeric value, and not the unit-of-measure (UOM) symbol used
to express it. Exact correspondence under Q3 does **not** require that
the PurchaseOrder record the identical raw numeric value and identical
UOM symbol as the Selected Quantity. Example: Selected Quantity = 90 EA;
PurchaseOrder = 9 CASE; 1 CASE = 10 EA. Where this conversion is known
with certainty not to change the economic quantity, it does not conflict
with Q3. By contrast, numeric differences that do change the economic
quantity — e.g., 90 → 80, 90 → 100, 95 → 90, 95 → 100 — are **not**
compatible with the exact economic-quantity correspondence Q3 requires.

**Important distinction:** Q3 does **not** mean "PurchaseOrder quantity
must always equal Selected Quantity as a raw numeric field." The
normative requirement is that **economic quantity** must correspond
exactly. UOM/representation mapping, supplier-specific representation,
or ERP-specific representation that does not change economic quantity is
not forbidden by Q3; such transformations are evaluated, where
applicable, under `CR-D2`.

**Relationship to existing ratified decisions:** Q3 must be read together
with: `CR-A` (PO decision-bearing commercial content derives from the
approved decision represented in the frozen DecisionPackage); `CR-B.1`
(PO content has a normative correspondence relationship with the
approved decision); `CR-B.2` (applicable decision-bearing commercial
content has exact correspondence — Q3 states precisely what "exact"
means for quantity specifically, at the economic-quantity level);
`SC-1` (decision-bearing commercial content is classified at the
semantic-concept level, not by database field or recorded instance — Q3
applies this classification to the quantity concept); `CR-D1` (a
defined transformation/mapping relationship exists between the approved
decision and the PurchaseOrder — Q3 clarifies that, for quantity, this
relationship's economic output must be exact); `CR-D2` (representational/
technical transformations are permitted only when they do not change
decision-bearing commercial meaning — Q3's UOM/CASE example is an
instance of this). Q3 does not modify, reinterpret, or extend any of
these — all remain exactly as previously ratified.

**Evidence:** explicit human ratification, from the Q3 ratification task
following the independent review, adversarial validation, and formal
consistency audit of the Selected Quantity ↔ PurchaseOrder Quantity
relationship.

**Scope:** Establishes only that economic quantity (not raw numeric
value or UOM symbol) is the unit of exact correspondence between
Selected Quantity and PurchaseOrder quantity content. Does not modify
CR-A, CR-B.1, CR-B.2, SC-1, CR-D1, CR-D2, APO-D1, APO-D2, QS-C1, or
QS-C2 — all remain exactly as previously ratified.

**Explicit non-decisions:** Q3 does not decide and must not be read as
deciding:
1. **CT-A1 / same-Approval commercial deviation** — **now settled
   separately (see `CT-A1` below): NOT PERMITTED.** Whether a different
   commercial outcome may ever be authorized by some other mechanism
   (`CT-A2`) remains OPEN.
2. **CT-B / transformation governance** — how any commercial deviation
   would be governed (new DecisionPackage, new Approval,
   exception/override, or another mechanism) remains OPEN.
3. **PS-1 / pre-SENT PO modification** — who may change PO content
   before SENT, and under what conditions, remains OPEN.
4. **Multi-supplier allocation** — whether a Request Line may be split
   across suppliers remains OPEN.
5. **Quantity allocation** — how Selected Quantity would be distributed
   across multiple suppliers, if ever permitted, remains OPEN.
6. **Undercoverage / overcoverage policy** — how a Quoted Quantity lower
   or higher than Requested Quantity is handled remains OPEN.
7. **MOQ / packaging policy** — MOQ, packaging, case-pack, and rounding
   business rules themselves are not resolved by Q3.
8. **Supplier substitution** — whether the PO supplier may differ from
   the approved supplier remains OPEN.
9. **QuoteVersion substitution** — whether the PO may use a different
   QuoteVersion than the one approved remains OPEN.
10. **Approval ↔ PO traceability** — the structural/historical
    traceability mechanism remains OPEN.
11. **PO cardinality** — how many PurchaseOrders may result from one
    Approval/DecisionPackage remains OPEN.
12. **Transmission / execution authority** — authority/capability rules
    for sending a PO or writing to the ERP are not resolved by Q3.

None of these items is closed, narrowed, or resolved by Q3.

### Q3-CV — Known-With-Certainty Conversion Evidence Standard

**Statement:** A quantity/UOM/packaging conversion may qualify as a
"known with certainty" conversion for purposes of `Q3` and `CR-D2` only
when the conversion fact has passed Validation and reached
`PersistedClaim` status under the existing `R11` evidence pipeline. An
unvalidated `StructuredClaim`, AI extraction alone, AI confidence,
unsupported inference, or an unvalidated human/supplier assertion does
not satisfy this standard, consistent with `R12`. Where relevant
credible evidence conflicts regarding the conversion, the conversion
shall not be treated as known with certainty until the conflict has been
resolved through validation. This decision does not establish a
mandatory corroboration count, source-authority hierarchy,
temporal/effective-dating model, contextual applicability model,
validation mechanism, schema, storage model, or implementation workflow.
Those remain separate questions.

**Evidence:** explicit human ratification, from the Q3-CV independent
architectural assessment of the evidentiary threshold for `Q3`'s
"known with certainty" phrase.

**Scope:** Q3-CV establishes only the evidentiary threshold for invoking
a quantity/UOM/packaging conversion as a "known with certainty"
technical/representational conversion under `Q3` and `CR-D2`. It does
not redefine `Q3`; does not redefine economic quantity; does not expand
or narrow `CR-D2`'s substantive transformation scope; does not establish
which sources are authoritative or any source hierarchy; does not
require a specific number of corroborating sources; does not define what
the Validation mechanism must technically do; does not define
temporal/effective-dating semantics; does not define contextual
applicability semantics; does not determine database schema, storage,
or API/service/workflow implementation; and does not resolve
packaging/MOQ policy, undercoverage/overcoverage, supplier substitution,
QuoteVersion substitution, PO cardinality, Approval ↔ PO traceability,
transmission/execution authority, the `CT-A2` mechanism, or
`CT-A3`/`CT-A4`.

**Relationship to existing ratified decisions:** Q3-CV does not modify,
reinterpret, or extend `Q3`, `CR-A`, `CR-B.1`, `CR-B.2`, `CR-C`, `CR-D1`,
`CR-D2`, `SC-1`, `R11`, `R12`, or `RL-C4` — all remain exactly as
previously ratified. Q3-CV is the application of `R11`'s existing
evidence pipeline (`Source → CapturedEvidence → AI Extraction →
StructuredClaim → Validation → PersistedClaim`) and `R12`'s "confidence
never substitutes for evidence" principle to the specific question of
when a `Q3`/`CR-D2` quantity/UOM/packaging conversion fact is
sufficiently established. If a packaging relationship is itself a
decision-bearing commercial term rather than a fixed technical fact,
`SC-1`'s classification test remains applicable and is unaffected by
Q3-CV — Q3-CV addresses only the evidentiary standard for a conversion
that is otherwise eligible to be treated as a technical,
non-decision-bearing conversion.

**Explicit non-decisions:** Q3-CV does not decide and must not be read
as deciding:
1. **Mandatory corroboration count** — whether, or how many,
   corroborating sources are required remains OPEN.
2. **Source-authority hierarchy** — whether any source (e.g., customer
   ERP/master data, supplier quotation, supplier technical document)
   takes precedence over another remains OPEN.
3. **Validation mechanism** — what `R11`'s `Validation` step must
   technically consist of for this fact type remains OPEN.
4. **Temporal / effective-dating model** — whether and how a
   previously-validated conversion's currency is tracked over time
   remains OPEN.
5. **Contextual applicability model** — whether a validated conversion's
   applicability varies by product, supplier, customer, or packaging
   variant remains OPEN.
6. **Conflict resolution mechanism** — how a conflict between credible
   sources is actually resolved (beyond the conversion not being "known
   with certainty" until resolved) remains OPEN.
7. **Schema, storage, or implementation workflow** — remain OPEN.
8. **MOQ/packaging policy, undercoverage/overcoverage, supplier
   substitution, QuoteVersion substitution, PO cardinality, Approval ↔ PO
   traceability, transmission/execution authority, `CT-A2` mechanism,
   `CT-A3`, `CT-A4`** — none resolved by Q3-CV.

None of these items is closed, narrowed, or resolved by Q3-CV.

## Commercial Transformation Governance Decisions (CT-A1–CT-A2)

**Naming note:** `CT-A1` is a new entry establishing its own grouped
prefix (`CT-`, Commercial Transformation) — not a subdivision of any
existing family. The informal shorthand `CT-A`/`CT-B` used throughout
the `SC-1`/`Q3` non-decisions lists and in the originating independent
analyses (CT-A Independent Semantic Review; CT-A1 Post-Approval
Commercial Deviation Principle analysis) is preserved as this entry's
cross-reference; `CT-A1` is the first, narrowest atomic sub-question of
that broader `CT-A` shorthand. `CT-A2` (whether a different commercial
outcome may ever be authorized by some mechanism other than the same
Approval) is ratified below, establishing only that any such different
commercial outcome must itself become an approved decision with its own
corresponding Approval before it may be embodied in a PurchaseOrder. The
technical/workflow mechanism by which a new approved decision and
Approval are formed, and `CT-B` (governance of any such mechanism),
remain unratified and are addressed, if at all, only in their own
separate future ratification packages.

### CT-A1 — Post-Approval Commercial Deviation Principle

**Statement:** A PurchaseOrder may not contain decision-bearing
commercial content whose commercial meaning differs from the approved
decision represented in the frozen DecisionPackage and authorized by the
same Approval.

**Scope:** This decision determines only: the same Approval; the same
approved decision; decision-bearing commercial content; and divergence
measured in terms of commercial meaning. It does not address what
happens if a different commercial outcome is genuinely needed — that is
`CT-A2`, not decided here.

**Evidence:** explicit human ratification, from the CT-A1 Post-Approval
Commercial Deviation Principle independent semantic analysis, itself
built on `CR-A`, `CR-B.1`, `CR-B.2`, `SC-1`, and `Q3`.

**CR-D2 boundary:** CT-A1 must not be read as "commercial transformation
is generally prohibited." Representational, formatting,
identifier-mapping, normalization, or ERP/supplier-specific technical
transformations that do not change decision-bearing commercial meaning
remain permitted exactly as `CR-D2` already states. CT-A1 governs only
content that does carry a different commercial meaning.

**Q3 boundary:** Consistent with `Q3`, a difference in economic quantity
between Selected Quantity and PurchaseOrder quantity is a commercial
deviation within CT-A1's scope — not a representational matter — when it
is not explained by a disclosed, economically-neutral unit/packaging
mapping already covered by `CR-D2`/`Q3`.

**Relationship to existing ratified decisions:** CT-A1 does not modify,
reinterpret, or extend `CR-A`, `CR-B.1`, `CR-B.2`, `CR-C`, `CR-D1`,
`CR-D2`, `SC-1`, `Q3`, `APO-D1`, `APO-D2`, `M2`, or `U3` — all remain
exactly as previously ratified. CT-A1 is, in substance, the direct
consequence of `CR-B.2`'s already-ratified EXACT correspondence
requirement (as clarified by `SC-1`'s classification and `Q3`'s
economic-meaning gloss) applied to the case where commercial meaning
differs; it states explicitly what already followed from those
decisions, without redefining any of them.

**Explicit non-decisions:** CT-A1 does not decide and must not be read
as deciding:
1. **CT-A2** — **now settled below: a different commercial outcome must
   itself become an approved decision with its own corresponding
   Approval.** The technical/workflow mechanism by which that occurs
   remains OPEN (see `CT-A2`'s own explicit non-decisions).
2. **New/revised DecisionPackage mechanics, or `SUPERSEDED`** — whether
   or how an existing DecisionPackage's lifecycle state changes to
   accommodate a different outcome is not decided or implied by CT-A1.
3. **Revision workflow** — any process for re-forming a decision remains
   OPEN.
4. **CT-B / transformation governance** — how any eventually-permitted
   deviation would be authorized, recorded, or audited remains OPEN.
5. **PS-1 / pre-SENT PO modification** — remains OPEN.
6. **Supplier substitution** and **QuoteVersion substitution** — remain
   OPEN, separate decision families.
7. **Multi-supplier allocation, quantity allocation, undercoverage/
   overcoverage policy, MOQ/packaging policy** — none resolved by CT-A1.
8. **PO cardinality** — remains OPEN.
9. **Approval ↔ PO traceability** — remains OPEN.
10. **Transmission / execution authority, ERP execution** — remain
    OPEN. In particular, holding Execution Authority or technical
    Capability does not, by itself, normatively legitimize
    commercial-meaning-differing content — `Approval ≠ Execution
    Authority ≠ Capability` remains exactly as previously ratified (`C`,
    `B2`, `U3`); CT-A1 does not create, modify, or imply any universal
    authorization model or universal authority entity.

None of these items is closed, narrowed, or resolved by CT-A1.

### CT-A2 — New Approved Decision Requirement

**Statement:** If a PurchaseOrder must embody a decision-bearing
commercial outcome whose commercial meaning differs from the approved
decision represented in the frozen DecisionPackage and authorized by the
existing Approval, that different commercial outcome must itself become
an approved decision with its own corresponding Approval before it may
be embodied in the PurchaseOrder.

**Scope:** This decision determines only that a new approved decision
and new corresponding Approval are required before a commercial-meaning-
differing outcome may be embodied in a PurchaseOrder. It does not
determine, and explicitly leaves open, the technical or workflow
mechanism by which that new approved decision and Approval come to
exist. In particular, CT-A2 does not state that `SUPERSEDED` (the
existing `DecisionPackage` lifecycle state) is the mechanism required to
satisfy it, does not state that every commercial transformation requires
a new Approval, and does not state that every technical difference
between a Selected Quantity/decision and a PurchaseOrder requires a new
Approval — only a difference that is itself decision-bearing commercial
content under `SC-1` triggers CT-A2 at all.

**Relationship to CT-A1:** CT-A2 answers the question CT-A1 explicitly
left open: CT-A1 establishes that commercial-meaning-differing content
may not exist under the same Approval; CT-A2 establishes what must
happen instead when a different commercial outcome is genuinely needed —
it must become its own approved decision with its own Approval, not be
embodied under the existing one by any other means. CT-A2 does not
weaken, narrow, or reinterpret CT-A1's prohibition; CT-A1 remains exactly
as ratified.

**Evidence:** explicit human ratification, from the CT-A2 independent
semantic analysis (concluding REQUIRES NEW APPROVED DECISION), itself
derived from `CR-A`'s affirmative sourcing requirement, `CR-C`'s
exclusive decision-formation → freeze → Approval pathway, `APO-D1`'s
Approval → PurchaseOrder existence gate, and `APO-D2`'s explicit
separation of Approval from Execution Authority/Capability (which rules
out those as substitute sources of commercial-content authorization).

**CR-D2 boundary:** CT-A2 must not be read as "commercial transformation
is generally prohibited." Representational, formatting,
identifier-mapping, normalization, or ERP/supplier-specific technical
transformations that do not change decision-bearing commercial meaning
remain permitted exactly as `CR-D2` already states — the 90 EA = 9
CASE × 10 EA example remains a permitted technical transformation, not an
instance requiring a new approved decision under CT-A2. CT-A2 governs
only outcomes that do carry a different commercial meaning.

**Q3 boundary:** CT-A2 does not resolve, and must not be read as
resolving, how a Selected Quantity of 100 and a desired PurchaseOrder
economic quantity of 90 (or any other MOQ/packaging-, undercoverage/
overcoverage-, allocation-, or multi-supplier-driven quantity divergence)
is to be handled. Whether such a divergence is permitted at all, and if
so by what quantity-domain policy, remains entirely OPEN; CT-A2 states
only that if such a divergence is decision-bearing commercial content
under `SC-1`/`Q3`, it needs its own approved decision and Approval — not
what that policy is, nor how it is formed.

**Approval / Execution Authority / Capability boundary:** CT-A2 does not
create, modify, or imply any universal Authority entity, generic
authorization object, or universal authorization service. `Approval ≠
Execution Authority ≠ Capability ≠ Tenant Binding` remains exactly as
previously ratified (`C`, `B2`, `U3`). Holding Execution Authority or
technical Capability does not, by itself, satisfy CT-A2's new-approved-
decision requirement.

**Illustrative semantic chain (non-normative):** the general shape
AI Recommendation → Human Decision Formation → Frozen DecisionPackage →
Approval → Approved Decision → PurchaseOrder, already implicit in
`CR-A`/`CR-C`/`APO-D1`/`APO-D2`, illustrates why a new commercial outcome
needs a new instance of that chain; this illustration introduces no new
lifecycle mechanics, states, or transitions beyond what is already
ratified.

**Relationship to existing ratified decisions:** CT-A2 does not modify,
reinterpret, or extend `R1`–`R14`, `M2`, `B2`, `C`, `U3`, `D5-R1`,
`D5-R2`, `PI-C1`–`PI-C11`, `RL-C1`–`RL-C4`, `QS-C1`–`QS-C2`,
`APO-D1`–`APO-D4`, `CR-A`, `CR-B.1`, `CR-B.2`, `CR-C`, `CR-D1`, `CR-D2`,
`SC-1`, `Q3`, or `CT-A1` — all remain exactly as previously ratified.

**Explicit non-decisions:** CT-A2 does not decide and must not be read
as deciding:
1. **CT-B / transformation governance** — how a new approved decision
   and Approval are formed, recorded, or audited remains OPEN.
2. **`SUPERSEDED` semantics** — whether, when, or how the existing
   `DecisionPackage.SUPERSEDED` lifecycle state is used in connection
   with a new approved decision is not decided or implied by CT-A2.
3. **DecisionPackage revision mechanics** — any process for revising,
   re-forming, or re-freezing a DecisionPackage remains OPEN.
4. **PS-1 / pre-SENT PO modification** — remains OPEN.
5. **Supplier substitution** and **QuoteVersion substitution** — remain
   OPEN, separate decision families.
6. **Multi-supplier allocation, quantity allocation** — remain OPEN.
7. **Undercoverage/overcoverage policy, MOQ/packaging policy** — remain
   OPEN.
8. **PO cardinality** — remains OPEN.
9. **Approval ↔ PO traceability** — remains OPEN.
10. **Transmission / execution authority, ERP execution** — remain OPEN.
11. **Any implementation mechanism** — schema, workflow, UI, or process
    design for satisfying CT-A2 is not decided or implied.

None of these items is closed, narrowed, or resolved by CT-A2.

## Human Authentication Architecture Decisions (AUTHN-1–AUTHN-12)

**Naming note:** this family establishes a new grouped prefix, `AUTHN-`
(Authentication), distinct from both the existing `Authority`/`Authorization`
vocabulary (`C`, `B2`, `U3`) and from the informal `AUTH-1` through `AUTH-6`
labels already used in this repository's commit messages
(`87f6e2c`, `3343b40`, `58441f1`) to describe sequential *implementation
phases* of the API's authentication boundary. Those labels name engineering
work phases, not ratified decisions, and are not redefined, superseded, or
referenced by this entry beyond this disambiguation note — `AUTHN-` is
chosen specifically so a future reader is never left to guess whether
"AUTH-4" means the fourth implementation step or a ratified decision ID.
This follows the same disambiguation discipline already established by
`CR-D2` (distinguishing itself from the unrelated `D5-R` cancellation
family and from its own human-assigned `D5-A` working label).

This family records the ratified **architecture** for human-facing
authentication. It does not itself implement anything — see each entry's
explicit non-decisions, and the closing "Decision Status" note below.

### AUTHN-1 — Human Authentication Architecture: OIDC → Session → Principal

**Statement:** For human-facing product channels, authentication is based
on standard OpenID Connect (OIDC). The ratified architecture is:

```
External OIDC identity
  → server-side session
  → existing Principal { userId, tenantId }
  → Procurement API
  → existing tenant binding / authorization
  → Procurement Core
```

The pilot may authenticate against a personal Google or personal
Microsoft account. No corporate Microsoft Entra ID tenant or Google
Workspace domain will be established solely for the pilot. The OIDC
implementation must be generic at the protocol/claims boundary and must
not be special-cased to "personal Gmail," "personal Outlook," or any
other Google-specific or Microsoft-specific account semantics.

**Scope:** Establishes only the authentication architecture shape above
and the pilot's permitted identity source. Does not modify `Principal`
(see `AUTHN-6`), `assertTenantMatches`, or `domain/authorization.ts` (see
`AUTHN-7`) in any way.

**Explicit non-decisions:** Provider selection (Google vs. Microsoft, or
any other OIDC-conformant provider) is **not** ratified here — it remains
a separate, provider-specific implementation sub-decision. This entry
does not ratify multi-provider support, per-tenant issuer configuration,
or any specific OIDC library/SDK.

**Evidence:** explicit human ratification, from the independent
authentication-technology assessment conducted after AUTH-1–6
(commit `58441f1`) and the subsequent business-context re-assessment
(single pilot user, personal account, planned chatbot/ERP/hybrid product
channels).

### AUTHN-2 — External Identity Key: (issuer, subject)

**Statement:** The external identity mapping is conceptually keyed by
`(issuer, subject) → User.id` — never by `subject` alone.

**Scope:** This is a forward-compatible identity-key principle only. It
does **not** ratify multi-provider support, per-tenant multi-issuer
support, or any specific mapping storage mechanism for the current
implementation. The existing internal identity chain is unchanged:
`User.id → User.tenantId → Principal { userId, tenantId }`.

**Explicit non-decisions:** Schema/table design for the mapping, whether
it lives on `User` or a separate table, and provisioning mechanics (see
`AUTHN-5`) are not decided here.

### AUTHN-3 — OIDC Flow and Excluded Mechanisms

**Statement:** The ratified flow is Authorization Code + PKCE. No
JWT-based application session is ratified. No custom username/password
authentication is ratified. No self-service signup is ratified. No
just-in-time (JIT) user provisioning is ratified.

**Scope:** Establishes the flow and excludes the four listed alternative
mechanisms for this architecture. Does not evaluate or rule out JWTs,
passwords, signup, or JIT provisioning for any *other*, separately
ratified, future context (e.g., `AUTHN-8`'s machine-identity class,
which is explicitly its own future decision).

### AUTHN-4 — Session Model

**Statement:** A server-side session is used. For the pilot, session
state is persisted in PostgreSQL, because PostgreSQL already exists as
the application's persistence infrastructure. Redis is not introduced
for the pilot. The browser receives a session cookie that is `httpOnly`,
`Secure`, and carries a deployment-appropriate `SameSite` policy.

**Explicit non-decisions:** The exact `SameSite` value is **not** decided
here — it is deployment/topology-dependent and is deferred to
implementation/deployment configuration. In particular, this entry does
**not** ratify that distinct frontend/API origins automatically require
`SameSite=None`. Redis is not ruled out permanently — only not introduced
for the pilot; adopting it later is a separate, not-yet-needed decision.

### AUTHN-5 — User Provisioning

**Statement:** Users are pre-provisioned. An external OIDC identity maps
to an existing `User` record. No JIT user creation is ratified. No
self-service registration is ratified. No provisioning UI is required to
satisfy this authentication architecture.

**Scope:** The existing single-tenant `User.tenantId` model is unchanged
by this decision.

**Production provisioning mechanism — ratified 2026-10-06:** Production
user provisioning SHALL use explicit provisioning of an already-existing
`User` by linking a verified external OIDC identity, represented by the
existing `(issuer, subject)` pair, to that `User`. This operation
preserves the security properties already established by `AUTHN-12` and
the existing implementation:

1. The target `User` MUST already exist.
2. Provisioning MUST NOT create a `User` as a consequence of
   authentication.
3. JIT/self-registration is excluded.
4. `(issuer, subject)` is the external identity key.
5. Email MUST NOT be used as the identity key.
6. Email/domain claims MUST NOT determine tenant membership.
7. Tenant membership is derived from the target `User`'s existing
   tenant.
8. A conflicting existing `(issuer, subject)` mapping MUST fail closed.
9. Existing mappings MUST NOT be silently reassigned.
10. Provisioning is an explicit administrative/provisioning action, not
    a login-reachable end-user self-claim operation.
11. Authentication, identity provisioning, authorization, tenant
    binding, and Execution Authority remain separate concepts
    (consistent with `AUTHN-7`, `C`, `B2`, `U3`).

**Provisioning authority boundary — ratified 2026-10-06:** Production
identity provisioning has a distinct authorization boundary from
ordinary procurement-domain authorization:

1. Application-level authority to perform external-identity
   provisioning MUST NOT be implied by an ordinary procurement-domain
   role. `procurement_user` does not imply provisioning authority;
   `approver` does not imply provisioning authority; no future
   procurement-domain role may implicitly imply provisioning authority
   either. The existing flat `User.role` value MUST NOT be treated as
   an implicit grant of provisioning authority merely because that
   role is permitted to perform procurement-domain operations.
2. When provisioning is performed through the application, the
   provisioning actor MUST be bound to the same tenant as the target
   `User`: actor identity and actor tenant come from the authenticated
   `Principal`; the target `User` must already exist; the target
   `User`'s tenant must match the actor's tenant; the external identity
   being linked remains the verified `(issuer, subject)` pair already
   ratified above. Provisioning MUST NOT cross tenant boundaries.
3. The application-level provisioning permission is a domain-specific
   identity-provisioning capability. This MUST NOT create or imply a
   universal/canonical Authority entity or a universal authorization
   abstraction — consistent with `U3`'s guardrails (no canonical
   shared Authority entity; no assumption that all domains share one
   authorization implementation; domain-specific enforcement remains
   permitted where a distinct domain requires it). The provisioning
   domain is therefore permitted to define its own capability
   semantics without introducing a system-wide Authority model.
4. The existing `AUTHN-12` out-of-band operator/database provisioning
   path remains an operational/access-control matter outside this
   application-level actor model. This boundary does not turn the
   platform/operator path into an application role or an application
   `Principal`, and does not create a new formal platform-operator
   authorization model. `AUTHN-12` remains unchanged.

**Capability representation — ratified 2026-10-06:** The application-
level provisioning capability's minimal representation is ratified:

1. Provisioning capability MUST NOT be represented as another value of
   the existing `User.role` field. `User.role` remains the
   representation of the procurement-domain role model only.
   Provisioning capability is additive and independent of it: a `User`
   may hold a procurement role and provisioning capability at the same
   time. The capability MUST NOT require mutually-exclusive combined
   role values.
2. The application-level provisioning capability SHALL be represented
   by an additive Boolean capability on the existing `User` record.
   The Boolean SHALL default to `false` for existing and newly-created
   `User`s, unless a future ratified decision explicitly establishes
   another provisioning bootstrap rule. The exact field name is
   **not** ratified by this decision.
3. Provisioning authorization SHALL use a dedicated, narrow
   provisioning-specific authorization check. It MUST NOT reuse
   `assertActorAuthorized(...allowedRoles)` for provisioning
   decisions, and MUST NOT introduce a generic system-wide
   `authorize()` abstraction merely for this capability. The
   provisioning-specific check SHALL: resolve the acting `User` from
   the authenticated `Principal`; verify the provisioning capability;
   enforce the already-ratified tenant boundary; and ensure the
   target `User` belongs to the actor's tenant.
4. Existing procurement-domain role authorization is unchanged: the
   existing `procurement_user`/`approver` role checks continue to use
   `assertActorAuthorized`, exactly as before this decision.
5. `ExternalIdentity`'s data model does not change as a consequence of
   this decision. Its existing `(issuer, subject)` uniqueness and
   fail-closed provisioning semantics remain exactly as already
   ratified. This decision determines only how application-level
   authority to invoke provisioning is represented and checked.
6. The capability is inherently tenant-scoped through the existing
   `User` → `tenantId` relationship and the authenticated `Principal`.
   Application-level provisioning MUST NOT cross tenant boundaries. No
   new universal/global capability model is introduced.

**Bootstrap — ratified 2026-10-06:** The first application-level
provisioning-capable `User` for a tenant SHALL be established through
an explicit out-of-band operator-level action that is outside the
application's normal authorization model. This is evidenced directly
by this repository's own precedent: all foundational `Tenant` and
`User` creation already happens out-of-band (there is no
application-level tenant-creation or user-creation workflow), every
`User`'s provisioning capability defaults to `false`, and an
application-level actor therefore cannot grant the first instance of
this capability without already holding the very authority it would
be bootstrapping. An out-of-band operator action breaks this
dependency without introducing any new application-level privileged
identity or role.

The bootstrap action SHALL be:

1. explicit;
2. operator-controlled;
3. outside the application's normal authenticated-user authorization
   model;
4. fail-closed;
5. applicable only to an already-existing `Tenant`/`User`;
6. incapable of creating a `User` or `Tenant` implicitly;
7. incapable of creating an OIDC identity implicitly;
8. not reachable through the normal login/authentication flow;
9. not exposed as a normal tenant-user API/UI capability;
10. separate from the ongoing grant/revoke mechanism, which remains
    OPEN — the bootstrap action establishes the initial capability
    state only; it does not define that capability's subsequent
    lifecycle.

**No implicit role:** This decision does not introduce a tenant-admin
role, a platform-operator `Principal`, a provisioning role, a generic
Authority entity, a generic permissions framework, or a new
application authorization layer. The operator-level nature of the
bootstrap action is an operational boundary, not a new
application-domain role.

**AUTHN-12 boundary (bootstrap):** This decision does not modify or
generalize `AUTHN-12`. `AUTHN-12` remains exactly as previously
ratified: it handles verified `(issuer, subject)` → existing-`User`
identity linking; it remains the pilot provisioning mechanism; it does
not become the bootstrap-capability mechanism; it does not establish
an application role; it does not establish a generic
operator-authority concept. The future bootstrap mechanism MUST be a
distinct mechanism from `AUTHN-12`, even though it may follow similar
operational properties (explicit, fail-closed, not login-reachable).

**Bootstrap implementation form — ratified 2026-10-06:** The first
application-level provisioning-capable `User` for a tenant is
established by an explicit, operator-controlled action implemented as
a standalone TypeScript operator script under `app/src/scripts/`,
independent of and distinct from `AUTHN-12`'s
`provisionExternalIdentity.ts` script/function. `AUTHN-12`'s
script/function is not extended or generalized for this
capability-bootstrap purpose. Seed tooling (`seed.ts`) is not used for
this purpose. No internal authenticated HTTP/API/UI route is created
for this action. No generic administrative CLI/framework is created.
This action grants the capability on an already-existing `User`
only — it does not create a `Tenant` or `User`, and does not perform
identity provisioning (`(issuer, subject)` linking remains exclusively
the production mechanism's and `AUTHN-12`'s concern, unaffected by
this entry). The action remains explicit, fail-closed, and
operator-controlled, consistent with the bootstrap semantic properties
already ratified above.

**Explicit non-decisions (implementation form):** The exact script
file name, exact function name, exact npm-script name, exact CLI
argument syntax, idempotency/repeat-run behavior (whether granting an
already-`true` capability succeeds silently or fails closed), operator
access management (who holds the credentials needed to run it, and how
that access itself is governed), and the subsequent grant/revoke
lifecycle all remain OPEN (see `docs/decisions/open.md`).

**Scope of this ratification:** This ratifies the provisioning
mechanism's *semantic shape*, the provisioning-authority boundary, the
capability's minimal representation shape, the bootstrap semantic
direction, and the bootstrap implementation form above — not the
complete user-management architecture, and not any specific code,
schema, route, or exact script content. It does **not** determine: the
exact Boolean field name; the exact authorization function name; the
exact HTTP route; the exact UI; the exact migration name; the exact
script/function/npm-script name; the exact CLI argument syntax;
idempotency/repeat-run behavior; who operationally holds the operator
access used to perform the bootstrap action, or how that access is
managed; whether one or multiple provisioning-capable `User`s are
permitted per tenant; whether every tenant automatically receives a
provisioning-capable `User`; whether a tenant administrator concept is
introduced; who is permitted to grant/revoke the Boolean capability
after bootstrap (the subsequent lifecycle); invitation/email
infrastructure; bulk provisioning; SCIM/directory integration; user
disable/re-enable semantics; session revocation semantics; identity
re-linking semantics; multi-tenant membership (`R5`); or audit-log
implementation. **All of the above remain tracked separately as OPEN**
(see `docs/decisions/open.md`).

**Relationship to AUTHN-12:** `AUTHN-12` remains exactly as previously
ratified — limited to the specific one-user pilot bootstrap — and does
**not** become the production provisioning mechanism merely because its
underlying validation logic (pre-existing `User` only, no `Tenant`
creation, fail-closed on conflicts, `(issuer, subject)` only, no email)
is the same logic this production rule generalizes around. `AUTHN-12`'s
own text is unchanged by this entry.

**Grant/Revoke Authority Separation — ratified 2026-10-06:**

1. Holding the performing provisioning capability
   (`User.canProvisionExternalIdentities = true`) does **not**, by
   itself, grant authority to grant or revoke that capability for
   another `User`.
2. The authority to perform provisioning and the authority to
   manage/grant/revoke the provisioning capability are distinct
   concepts.
3. Therefore, `assertProvisioningAuthorized(...)` MUST NOT be
   interpreted as, reused as, or extended into grant/revoke authority.
4. This repository does not currently ratify what specific role,
   capability, mechanism, or actor model will provide ongoing
   application-level grant/revoke authority.
5. The exact grant/revoke mechanism remains OPEN.
6. The existing out-of-band provisioning-capability bootstrap script
   (`grantProvisioningCapability.ts`) remains available as an
   independent, operator-controlled recovery/fallback path, including
   the case where a tenant has zero application-level
   provisioning-capable `User`s.
7. No application-level minimum-capable-user policy is implied by this
   ratification.
8. No self-grant or self-revoke policy is implied by this ratification.
9. No cardinality policy is implied by this ratification — cardinality
   remains exactly as previously ratified: unconstrained, not newly
   decided here.
10. This decision does not introduce or imply: a second capability; a
    provisioning-administrator role; a tenant-admin role; a generic
    permission system; a universal Authority entity; a new route; a
    UI; an API contract; audit requirements; invitations; SCIM; bulk
    provisioning; session revocation; identity re-linking; or any
    other lifecycle mechanism.
11. `AUTHN-12` and all previously ratified AUTHN-5 decisions remain
    unchanged.

**Explicit non-decisions:** As listed under "Scope of this ratification"
above. The exact provisioning mechanism's *implementation* (an
admin-only endpoint, an invitation flow, a continued operator action, or
otherwise) remains an implementation choice within the semantic rule now
ratified — not itself decided here. The exact ongoing grant/revoke
mechanism (§ "Grant/Revoke Authority Separation" above) is likewise not
itself decided here.

**Evidence:** Explicit human ratification via conversation, following
six independent read-only assessments of AUTHN-5 production user
provisioning: (1) provisioning-mechanism options (identity lifecycle,
security risk comparison of candidate mechanisms, current-code fit,
enterprise SaaS onboarding reality, and a neutral mechanism comparison);
(2) the administrative actor/role question (the security boundary of
provisioning, tenant-isolation scoping alternatives, a role-vs-
capability-vs-separate-authority analysis, and an enterprise
operating-model analysis); (3) the capability-representation
implementation assessment (tracing `assertActorAuthorized`'s actual
mechanism and call sites, comparing representation alternatives against
migration/runtime/coupling criteria, and security-failure-mode
analysis); (4) the first-capability bootstrap assessment (repository
evidence that all foundational Tenant/User creation is already
out-of-band, a neutral comparison of bootstrap candidate mechanisms, and
an analysis of the bootstrap circular-dependency and the AUTHN-12
boundary); (5) the bootstrap implementation-form assessment (repository
evidence on existing operator-script conventions, a neutral comparison
of implementation-form candidates against the fixed bootstrap baseline,
and a comparison against `AUTHN-12`'s existing script); and (6) the
grant/revoke lifecycle assessment (a privilege-escalation analysis of
collapsing performing-authority into grant/revoke authority, a
self-grant/self-revoke and lockout/compromised-actor analysis, and a
neutral comparison of candidate grant/revoke actor models), 2026-10-06.

### AUTHN-6 — Principal Contract Remains Unextended

**Statement:** The existing `Principal` contract remains authoritative
and unchanged:

```ts
Principal {
  userId: string;
  tenantId: string;
}
```

Channel identity, machine identity, OIDC provider fields, external
subject fields, Execution Authority, and ERP credentials must **not** be
added to `Principal` as part of this decision family.

**Scope:** This is a guardrail against scope creep into `Principal`
specifically, consistent with `U3`'s existing guardrails against a
universal Authority/identity abstraction. It does not foreclose any of
the excluded concepts existing elsewhere in the system under their own,
separately ratified, future representations (see `AUTHN-8`).

### AUTHN-7 — Authentication / Principal / Authorization / Tenant Binding Remain Separate Layers

**Statement:** The following layers are ratified as distinct and must not
be collapsed into one another:

- **Authentication** answers "who is this human?"
- **Principal resolution** answers "which internal `User` and tenant does
  this identity represent?" — the existing `Principal` contract.
- **Existing domain authorization** (`domain/authorization.ts`) answers
  "can this `User` perform this operation?"
- **Existing tenant binding** (`assertTenantMatches`) answers "does the
  requested tenant belong to this authenticated Principal?"

**Scope:** This restates, for the authentication layer specifically, the
separation already established by `C` ("Authority and Capability are
separate... Authentication is also distinct from all of the above") and
by AUTH-1–6's existing implementation. It does not modify
`domain/authorization.ts`, `assertTenantMatches`, or any existing
service/domain authorization semantics.

**Explicit non-decisions:** **Execution Authority** (`B2`) is correctly
named as a conceptually distinct, already-ratified layer — "can this
action actually be executed?" — but remains **entirely unimplemented**
in the codebase, both before and after this ratification. Nothing in
this decision family implements, narrows, or resolves Execution
Authority; it must not be read as having done so merely because this
architecture is now ratified.

### AUTHN-8 — ERP Machine Identity Is a Separate Future Class

**Statement:** ERP integration is explicitly a separate, future identity
class. ERP authentication will eventually use a machine-to-machine
credential model with its own tenant-binding and authorization mechanism.
ERP machine identity:

- is **not** a `Principal`;
- is **not** a `User`;
- does **not** use the human browser session;
- does **not** automatically receive human authorization;
- does **not** automatically receive Execution Authority;
- does **not** replace human authorization for consequential actions
  (freeze, Approval, PurchaseOrder creation), consistent with the
  existing ratified default that RFQ/PO/ERP writes are human-authorized
  absent a separate explicit ratification.

**Scope:** Establishes only the boundary above. No ERP authentication
implementation, no ERP identity entity, and no ERP authorization model
are designed or ratified here.

**Relationship to existing ratified decisions:** Consistent with, and
does not modify, `R4` (Core holds commercial authority, ERP holds
transaction/fulfillment authority), `B2`, `C`, and `U3`.

### AUTHN-9 — Product Channels Are Not Separate Core Authorization Models

**Statement:** The product's three planned usage modes — chatbot-only,
ERP-only, and hybrid — are product/channel modes, not three different
Procurement Core authorization models. For human-originated actions
across any channel, Procurement Core continues to receive the same
`Principal` contract. Chat/voice is a transport/UI channel, not an
identity class. ERP is the future machine identity class defined in
`AUTHN-8`, not a human `Principal`.

**Scope:** Establishes only this framing. Does not design any
chatbot-specific identity model, voice authentication, or AI
authorization model.

### AUTHN-10 — GET /tenants Security-Boundary Correction Requirement

**Statement:** Once real authentication is introduced, `GET /tenants`
must not expose all tenants to an authenticated user. The endpoint must
be scoped to the authenticated Principal's own tenant
(`principal.tenantId`).

**Scope:** This is a narrow authentication/security-boundary correction,
not a domain redesign, and must be included in the same change that
introduces real authentication — not before (today's fail-closed
composition root makes it unreachable) and not deferred after (the
moment real authentication exists, the gap becomes live).

**Explicit non-decisions:** This does not resolve `GET /tenants`'
broader, previously-flagged-OPEN product/contract question (what an
authenticated principal should see beyond "their own tenant" in some
future multi-tenant-membership world) — it resolves only the
single-tenant-per-user case the current schema already represents.

### AUTHN-11 — CORS Restriction Requirement

**Statement:** Once real browser-based authentication is introduced,
CORS must be restricted to the exact trusted frontend origin(s), with
credentials enabled as required for the server-side session cookie.
Wildcard origin access must not remain in production.

**Explicit non-decisions:** The exact deployment topology and the
cookie's `SameSite` setting (see `AUTHN-4`) remain implementation/
deployment concerns, not decided here.

### AUTHN-12 — Pilot Operator Provisioning (Google OIDC Pilot, First User Only)

**Statement:** For the Google OIDC pilot's first user, the `(issuer,
subject) -> User.id` mapping is established by a human operator,
out-of-band from any OIDC login attempt, via a controlled, one-time
operator action (a CLI/script or an equivalent manual, reviewable
mechanism — not an HTTP endpoint). This mechanism:

- maps a verified `(issuer, subject)` pair to an **already-existing**
  `User` record only — it never creates a new `User`.
- never creates a new `Tenant`.
- fails closed if the referenced `User` does not already exist.
- fails closed if the referenced `Tenant` does not already exist.
- fails closed if the `(issuer, subject)` pair is already mapped to a
  different `User` (the existing `@@unique([issuer, subject])`
  constraint is never worked around).
- is never triggered by, or reachable from, a login attempt — this is
  not JIT provisioning and not self-service signup.
- never uses email, or any claim other than `(issuer, subject)`, as an
  identity key.
- introduces no internal admin API and no admin UI.
- introduces no new domain concept (no "ProvisioningAuthority,"
  "AdminAuthority," or equivalent). Who may run this operator action is
  an operational/access-control question (who holds database/operator
  access for this one-time action) — not a new domain authorization
  model, and not Execution Authority (`B2`) or ordinary domain Approval
  under another name.

**Scope:** Ratifies only the pilot's specific first-user bootstrap
approach for exactly one user. Does not select, narrow, or imply a
production provisioning mechanism for N users — CLI, admin workflow,
invitation flow, or otherwise.

**Explicit non-decisions:** Does not modify `Principal` (`AUTHN-6`), the
`(issuer, subject)` identity key (`AUTHN-2`), tenant isolation, or
Execution Authority. Does not establish precedent for how the eventual
production provisioning mechanism will be chosen.

**Relationship to AUTHN-5:** `AUTHN-5`'s ratified statement — pre-provisioned
users, no JIT, no self-service registration, exact provisioning mechanism
not decided — is unchanged and remains fully binding. This entry narrows
nothing about `AUTHN-5`'s open status: it confirms only that the pilot's
single-user bootstrap already satisfies `AUTHN-5`'s existing constraints,
without resolving which mechanism production will eventually use for
more than one user. `AUTHN-5`'s own text is not edited by this entry.

**Evidence:** Explicit human ratification via conversation, 2026-10-06,
following an independent read-only assessment of pilot provisioning
options.

### Minimal Implementation Boundary (descriptive, not itself a ratified sub-decision)

The future implementation *may* include: a concrete `Authenticator`
implementation under `app/src/api/`; OIDC login/callback/logout routes;
PostgreSQL-backed session persistence; external identity → `User`
mapping; replacement of the current fail-closed production authenticator;
frontend credential transport using the server-side session; a real
authenticated UI replacing the manual tenant/actor selection mechanism;
restricted CORS (`AUTHN-11`); `GET /tenants` tenant scoping (`AUTHN-10`);
and appropriate tests for authentication behavior.

The following existing components remain unchanged by this decision
family: the `Principal` contract (`AUTHN-6`), `assertTenantMatches`,
`domain/authorization.ts`, existing service authorization semantics, and
the AUTH-1–6 HTTP security matrix (`Group 15`, commit `58441f1`).

### Non-Goals (explicitly not ratified by AUTHN-1–AUTHN-11)

Multi-IdP implementation; per-tenant configurable OIDC issuers; JWT
access/refresh tokens; custom password authentication; self-service
signup; JIT provisioning; `R5` multi-tenant `User` membership; RBAC
redesign; ERP machine authentication implementation; a chatbot-specific
identity model; voice authentication; AI authorization redesign; Redis
session infrastructure; a provisioning/admin UI; Execution Authority
implementation; an ERP authorization model.

### Decision Status

Recorded as a **RATIFIED architecture decision** (`AUTHN-1`–`AUTHN-11`).
This is a documentation-only ratification: no implementation layer
described above — the `Authenticator`, session storage, identity
mapping, login/callback/logout routes, frontend credential transport,
`GET /tenants` scoping, or CORS restriction — exists in the codebase as
of this ratification. The distinction between authentication, Principal
resolution, tenant binding, authorization, Execution Authority, and
future machine identity (`AUTHN-7`, `AUTHN-8`) must be preserved exactly
as stated once implementation begins. The repository remains in an
implementation-ready, not implementation-complete, state after this
ratification.

**`AUTHN-12` addendum (2026-10-06):** `AUTHN-1`–`AUTHN-11` above was
implemented in full by this point (OIDC login/callback/logout, session
persistence, external identity mapping, `/auth/me`, tenant scoping, CORS
restriction, frontend credential transport — all shipped). `AUTHN-12` was
ratified separately and later, after a real Google OIDC pilot client was
configured and a real browser login correctly reached the expected
"unknown external identity" outcome. `AUTHN-12` is scoped exclusively to
bootstrapping that one pilot user; it does not reopen, extend, or
implement any part of `AUTHN-1`–`AUTHN-11`, and `AUTHN-5`'s open
production-mechanism question is unchanged by it.

## RFQ Send Domain Decisions (RFQ-S1–RFQ-S2)

Context: `RFQDispatch` (schema, `R1`), its tenant-scoped domain service
(`rfqDispatchService.ts`), and its response-token issuance
(`rfqResponseToken.ts`/`issueResponseToken`) already exist and are
unaffected by this ratification. Nothing below authorizes, implements,
or schedules the actual SEND implementation itself — these are
documentation-only semantic ratifications made in advance of that
implementation, per this repository's established Fast Track Protocol
(`docs/development/implementation-playbook.md`) for RED-adjacent
decisions preceding a YELLOW implementation batch.

### RFQ-S1 — RFQ Send Technical Lifecycle (`SENDING` State)

**Statement:** RFQDispatch SEND follows the technical lifecycle:

```
PENDING → SENDING → SENT
PENDING → SENDING → SEND_FAILED
```

`SENDING` means: this system has successfully claimed the RFQDispatch
for one SEND attempt and is currently performing that external SEND
operation; the system has not yet recorded a terminal outcome. A
concurrent SEND attempt must not be able to claim the same RFQDispatch
once another caller has transitioned it to `SENDING` — exactly one
caller may hold `SENDING` for a given RFQDispatch at a time.

**Evidence:** Independent RFQ SEND concurrency/CAS semantic assessment
(this repository's own architecture-review history). Demonstrated by
direct scenario walkthrough that reusing an existing terminal value
(`SENT` or `SEND_FAILED`) as the claim-time marker forces the system to
assert a false fact about the external world during any crash between
claim and outcome, whereas a dedicated in-progress value only ever
asserts the system's own true epistemic state ("an attempt is in
progress, outcome not yet known").

**Scope:** Establishes only the existence and meaning of the `SENDING`
state and the requirement that it provide exclusive, atomic claiming.
Does not establish how SEND is triggered, who may trigger it (see
`RFQ-S2`), what happens to a dispatch that remains stuck in `SENDING`,
or how retries/resends are governed.

**No schema/migration required:** `RFQDispatch.status` is implemented
as a plain `String` column, not a Prisma/PostgreSQL enum type —
consistent with every other status column in this schema
(`ProcurementRequest`, `SourcingEvent`, `DecisionPackage`, `Approval`).
Adding `SENDING` to the set of values the application writes and
recognizes is an implementation/documentation convention, not a schema
change.

**Provider timeout / unknown outcome:** When a SEND attempt's outcome
cannot be determined (e.g., a provider timeout), the RFQDispatch
remains in `SENDING`. It must **not** be reinterpreted as `SEND_FAILED`
merely because the outcome is unknown — doing so would assert a false
fact (confirmed failure) about an attempt whose actual outcome may have
been success. This ratification does not define, and does not require,
any specific mechanism for later resolving a dispatch stuck in
`SENDING` — that recovery mechanism remains **OPEN** (see `open.md`).

**`RESPONDED` unchanged:** The existing `RESPONDED` status and its
relationship to `SENT` are unchanged and not redesigned by this
decision.

**`SENDING` MUST NOT be interpreted as:** Approval; Execution Authority;
application Authority; Capability; supplier authentication; delivery
confirmation; retry permission; resend permission; or a permanent
business status. It is technical process-lifecycle bookkeeping only — a
fact about this system's own execution, never a claim about the
external world beyond "an attempt is in progress."

**Explicit non-decisions:** RFQ resend/retry policy; stuck-`SENDING`
recovery mechanism; provider timeout/unknown-outcome recovery semantics;
token single-use/replay policy; token lifetime as business policy; quote
resubmission/requote/versioning policy; email provider selection;
provider message ID/delivery confirmation; `SEC-010` supplier
authentication; future Execution Authority design. None of these may be
inferred from `RFQ-S1` — see `open.md`.

### RFQ-S2 — RFQ Send Application Authorization

**Statement:** RFQ SEND is gated by the existing application
authorization mechanism, `assertActorAuthorized(tenantId, actorUserId,
allowedRoles)`, with `allowedRoles = ["procurement_user", "approver"]`.
No new role, no new generic capability/authorization framework, and no
relationship to `AUTHN-5`'s provisioning capability are introduced.

**Evidence:** Independent RFQ SEND authorization role semantic
assessment, based on the existing, demonstrated authorization matrix:
`approve` (creating the Approval fact itself) is gated `["approver"]`
only; `freezeDecisionPackage` and `createPurchaseOrderFromApproval` —
both workflow-progression actions distinct from the Approval decision
itself — are gated `["procurement_user", "approver"]`. SEND is a
workflow-progression action, not the Approval decision itself, and is
therefore governed by the same pattern as `freeze`/PO creation rather
than the pattern used for `approve` specifically.

**Why this role set, precisely:** this is an explicit ratification of
the existing non-approval authorization pattern applied to a new
action — not an inference that external communication carries the same
security properties as an internal DB write. SEND is the first
role-gated operation in this codebase with an external communication
side effect; `freeze` and PO creation, the only prior precedents for
this gate shape, are both internal-only. This decision does not claim
SEND "has always been covered" by that precedent — it explicitly
extends it, by ratification, to a materially new kind of action.

**Critical architectural separation (must be preserved exactly):**

```
Approval ≠ Application Authority ≠ Execution Authority ≠ Capability ≠ Tenant Binding
```

- Using `assertActorAuthorized` for SEND is an **application Authority**
  decision only. It does not implement, narrow, or resolve **Execution
  Authority** (`B2`), which remains separately defined and currently
  entirely unimplemented anywhere in this codebase.
- Approval does not grant SEND authority. The absence of an Approval
  does not itself determine SEND authority either way — under the
  ratified lifecycle, an Approval cannot exist yet at the point SEND
  occurs, so Approval and SEND authorization are simply unrelated, not
  sequentially dependent.
- `AUTHN-5`'s `canProvisionExternalIdentities` / provisioning
  authorization is unrelated to procurement SEND authorization; no
  relationship between them is created by this decision.
- `EmailSender` technical reachability (Capability) does not itself
  constitute or substitute for this authorization check (Authority) —
  the two remain distinct per `C`.

**This decision MUST NOT be read as:** establishing that
`procurement_user` + `approver` is the mathematically or conceptually
"least privileged" possible set; establishing that Approval is required
before SEND; establishing that SEND is equivalent to, or governed by the
same semantics as, PO execution; or establishing that Execution
Authority has been implemented.

**Explicit non-decisions:** future Execution Authority design or
implementation; whether a stricter or different role set should ever
govern external-communication actions generally; `AUTHN-5`
provisioning-capability lifecycle questions. None of these may be
inferred from `RFQ-S2` — see `open.md`.

## RFQ Supplier Response Domain Decisions (RFQ-R1–RFQ-R5)

Context: no part of the Supplier Response capability exists in code as of
this ratification (no endpoint, no consumption logic, no QuoteVersion
creation path from a supplier submission). These are documentation-only
semantic ratifications made in advance of that implementation, following
the same Fast Track Protocol discipline already used for `RFQ-S1`/`RFQ-S2`.
They narrow *how* Supplier Response must behave once built; they do not
build it.

### RFQ-R1 — Supplier Response Trust Model (V1 Minimum)

**Statement:** The minimum acceptable V1 trust mechanism for the Supplier
Response action is an opaque, cryptographically random response token.
Possession of a valid, unexpired, unconsumed token is sufficient to
submit one response for the single RFQDispatch it is scoped to.

**Evidence:** Independent Supplier Response architecture/security
assessment (this repository's own history). Every commercial consequence
of a Supplier Response is already gated downstream by the existing,
ratified Decision + Approval chain (`APO-D1`/`APO-D2`) — a response never
itself creates a Decision, never bypasses an Approval, never writes to
an ERP, and never creates a PurchaseOrder directly. This existing
downstream human-review gate is what makes a possession-only mechanism an
acceptable minimum for *this specific action*, not a general judgment
about supplier-authentication strength.

**Scope:** Ratifies only that possession-only is *sufficient* for V1 — it
does not rank, rule out, or design any stronger mechanism (supplier
accounts, a supplier portal, multi-channel verification) for future use.

**This decision does NOT close SEC-010 in general.** `SEC-010`
(`docs/security/enforcement-matrix.md`) remains OPEN as a general,
canonical status. This ratifies only an action-specific minimum
sufficiency judgment for Supplier Response, nothing broader.

**The token MUST NOT be interpreted as:** authentication; supplier
identity proof; Execution Authority; Capability in the `C` sense (it is
not "technical means," it is a scoped credential); a general-purpose
authorization mechanism; or Tenant Binding in the `AUTHN-6`/`AUTHN-7`
sense (tenant context is *derived* from the token's resolution, never
independently asserted by any caller).

**Explicit non-decisions:** supplier authentication beyond this V1
minimum; a supplier portal/account model; any ranking of stronger
mechanisms for future consideration. None of these may be inferred from
`RFQ-R1` — see `open.md`.

### RFQ-R2 — Token Is the Sole Client-Supplied Identifier

**Statement:** The Supplier Response action accepts exactly one
client-supplied identifier: the opaque response token. No other
identifier — dispatch id, supplier id, quote id, tenant id, sourcing
event id, or product id — may be accepted from the caller for the
purpose of determining which record the submission concerns. The
authoritative targeting chain is resolved entirely server-side, from the
token alone:

```
opaque token → RFQDispatch → tenantId → Supplier → SourcingEvent → RequestLine → Product
```

**Evidence:** Independent Supplier Response architecture/security
assessment. This is the direct extension, to an unauthenticated actor
class, of the same discipline already ratified for every Principal-bound
mutating route (tenant/actor identity is never trusted from a client
claim) — here, in the absence of any Principal at all, the token is the
sole, non-negotiable source of authoritative context.

**Scope:** This is a tenant-isolation and object-targeting invariant, not
an implementation detail. It constrains the *shape* of what the eventual
endpoint may accept as input, regardless of its exact technical
realization.

**Explicit non-decisions:** the exact endpoint path, request format, or
transport details. None of these are ratified here.

**Implication — unsupported fields are rejected, not silently ignored:**
a submission that includes any identifier this decision excludes (or any
field outside the `RFQ-R5` structured payload) must be rejected outright,
not silently accepted while quietly discarding the extra field. Silently
ignoring such a field would make this boundary's actual behavior
unverifiable to a caller and untestable as a security property; explicit
rejection keeps the boundary observable and testable. This is a direct
implementation implication of this decision's existing scope, not a new
decision.

### RFQ-R3 — Token Consumption Semantics

**Statement:** A response token is consumed only upon a fully validated,
successful Supplier Response submission. Consumption must be enforced by
an atomic, conditional database operation — not a separate
check-then-write sequence — such that of two concurrent submissions
against the same token, exactly one can succeed; the other must observe
a consumed/invalid outcome, indistinguishable from any other reason a
token is not currently usable (nonexistent, expired, already consumed).

**Non-consuming cases, explicitly:** viewing/retrieving the response
form does not consume the token; a malformed submission does not; a
submission that fails validation does not; an expired token is never
consumable; an already-consumed token cannot be consumed again.

**Evidence:** Direct extension of the already-ratified, already-proven
`RFQDispatch` SEND claim mechanism (`RFQ-S1`'s own `PENDING→SENDING`
atomic conditional update) to this new consumption point — the same
concurrency-safety reasoning applies identically.

**Field reuse, not new schema:** the existing `RFQDispatch.respondedAt`
field may serve as the token-consumed marker. This ratification does
**not** introduce, and explicitly rejects as unnecessary, any new
redundant field (e.g., a separate boolean consumption flag) for this
purpose.

**Explicit non-decisions:** whether a *new* token may later be issued for
a second attempt (resend/reissue policy); whether an already-submitted
response may ever be revised or superseded (quote revision/requote
policy). Neither is resolved by `RFQ-R3` — see `open.md`.

**`RFQDispatch.status` is explicitly NOT part of this decision.** The
sole authoritative consumption marker ratified here is `respondedAt`.
`RFQ-R3` does not transition `status` to `RESPONDED` (or any other
value), and must not be read as implicitly doing so merely because this
decision exists — `status` is left exactly as `RFQ-S1` already left it.
Whether the `RFQDispatch` lifecycle should ever transition `status` as a
consequence of a consumed token is a separate, future architecture
question, not decided by `RFQ-R3`.

### RFQ-R4 — Transactional Submission

**Statement:** Token consumption and QuoteVersion creation occur within
one local database transaction. If submission validation fails, neither
occurs. If QuoteVersion creation fails after validation passes, the
transaction rolls back and the token remains unconsumed. The system must
never reach a state where the token is consumed but no QuoteVersion
exists, or a QuoteVersion exists but the token was never marked
consumed.

**Evidence:** Independent Supplier Response architecture/security
assessment. Unlike RFQ SEND's own transaction boundary (which
deliberately excludes the external `EmailSender` call, per `RFQ-S1`'s own
Prepare≠Transmit reasoning), token consumption and QuoteVersion creation
are both purely local database operations with no external call between
them — full transactional atomicity is both possible and correct here,
which is the opposite boundary choice from SEND for a principled,
evidence-based reason, not an inconsistency.

**Scope:** Any future supplier-facing acknowledgement (e.g., a
confirmation email) is explicitly outside this transaction and outside
this ratification's scope — it is not part of V1.

### RFQ-R5 — V1 Supplier Response Data Scope

**Statement:** The V1 Supplier Response accepts structured input for
exactly the commercial fields `QuoteVersion` already has: quantity, unit,
unit price, and currency. Delivery time, payment terms, validity period,
free-form notes, attachments, and any document/email-based ingestion are
explicitly out of scope for V1.

**Validation posture:** reject, never coerce. A persisted value must be
the same semantic value as the submitted value; validation failure
rejects the submission outright rather than normalizing or guessing at
intent (consistent with `SEC-011`, UNKNOWN-never-inferred).

**Evidence:** Independent Supplier Response architecture/security
assessment, directly against the current `QuoteVersion` schema (no
delivery-time/payment-terms/notes/attachment field exists there today).

**Explicit non-decisions:** whether/how those additional fields are ever
added — that is a separate, future domain/architecture decision, not
pre-decided or foreclosed by `RFQ-R5`.

### Non-Goals (explicitly not ratified by RFQ-R1–RFQ-R5)

A generic `Evidence` model; a generic `StructuredClaim`/`PersistedClaim`
pipeline implementation; generic document ingestion; a raw email/PDF/
Excel evidence pipeline; a generic raw-submission-capture field on any
existing model (e.g., a `rawSubmission` JSON field on `SupplierQuote` or
`QuoteVersion`). None of these are ratified now. Given `RFQ-R5`'s scope
(a structured, four-field, reject-not-coerce V1 form), the persisted
`QuoteVersion` value is already the same value the supplier submitted —
no separate provenance-capture mechanism is being judged necessary for
V1 by this ratification. If a concrete provenance/evidence need emerges
later, it requires its own separate independent architecture assessment;
this ratification does not pre-empt or foreclose that. `R11`'s own
general conceptual status (`docs/decisions/ratified.md`) is unchanged.

Also explicitly not ratified or closed by `RFQ-R1`–`RFQ-R5`: `SEC-010`'s
general canonical status; RFQ resend/retry policy; stuck-`SENDING`
recovery; token lifetime as business policy; token resend/reissue
policy; quote revision/requote/versioning policy; email provider
selection; provider message ID/delivery confirmation; provider
timeout/unknown-outcome recovery; supplier authentication beyond the V1
possession minimum; a supplier portal/account model; Execution
Authority; RLS; a generic idempotency framework; `AuditLog`/`AuditEvent`.
All remain exactly as recorded in `open.md`.

### Canonical separation (must be preserved exactly)

```
Supplier Response capability ≠ Authentication ≠ Supplier Identity Proof
  ≠ Execution Authority ≠ Human Approval ≠ Tenant Binding

Approval ≠ Supplier Response Authorization
```

Accepting a Supplier Response does not mean a procurement decision has
been approved, and does not itself authorize anything beyond the single,
narrow act of recording that one response.

## DecisionPackage Semantics & Allocation Boundary (DP-1–DP-3)

**Naming note:** this family establishes a new grouped prefix, `DP-`
(DecisionPackage), distinguishing it from three unrelated things it must
never be confused with: the pre-existing bare `D-1`–`D-6` items in
`docs/decisions/open.md` (role terminology, authorization-verb layering,
delegated approval, cancellation, compromised-worker control — unrelated
topics); the informal `D1`–`D7` cross-references used inside `QS-C1`/
`QS-C2`'s own non-decisions text (multi-supplier combination, who/what
may construct a selection, etc.); and the `D5-R1`/`D5-R2`
cancellation-lifecycle family. None of those is renamed, renumbered, or
altered by this family's introduction.

### DP-1 — DecisionPackage Semantic Scope

**Statement:** `DecisionPackage` is, and remains, a single-supplier-scoped
atomic commercial decision: one chosen `Supplier`, one `QuoteVersion`,
one `SelectedQuantity`. This restates and makes canonically explicit what
already follows from `QS-C1` (Selected Quantity is drawn "from a supplier
quote"), `QS-C2` (Approval authorizes the Selected Quantity "as
represented in the frozen DecisionPackage" — singular), and `CR-A`/
`CR-B.1`/`CR-B.2` (PurchaseOrder content derives from and corresponds to
"the approved decision represented in the frozen DecisionPackage" —
singular).

**Evidence:** explicit human ratification, following an independent
read-only "DecisionPackage Semantics & Allocation Boundary" assessment
series (repository-state analysis of `decisionService.ts`,
`approvalService.ts`, `purchaseOrderService.ts`, `recommendationService.ts`,
`quoteService.ts`, and the Prisma schema, cross-checked against `QS-C1`,
`QS-C2`, `CR-A`, `CR-B.1`, `CR-B.2`, `CT-A2`, `RL-C1`–`RL-C4`, and `Q3`),
2026-10-07.

**Scope:** Restates, and does not modify, reinterpret, or extend, `QS-C1`,
`QS-C2`, `CR-A`, `CR-B.1`, `CR-B.2`, `CR-C`, `CR-D1`, `CR-D2`, `SC-1`,
`Q3`, `Q3-CV`, `CT-A1`, `CT-A2`, `APO-D1`, `APO-D2`, or `RL-C1`–`RL-C4` —
all remain exactly as previously ratified. `CR-C`'s Recommendation ≠
Decision separation is unaffected and unchanged.

**Explicit non-decisions:** whether this scope is ever extended to
multi-supplier combination (`QS-C1`'s own named future question,
informal `D1`); who/what may construct a selection (informal `D2`); any
allocation, MOQ, undercoverage/overcoverage, supplier-substitution, or
quote-revision/requote policy; DecisionPackage→PO or Approval→PO
cardinality (`Q3`, still OPEN); and the `DecisionPackage.SUPERSEDED`
reference appearing in `CT-A2`'s own text, which this entry does not
create, confirm, or ratify as implemented (see `DP-3`'s documentation
note below). None of these may be inferred from DP-1.

### DP-2 — Multi-Supplier Representation Without an Allocation Fact

**Statement:** Today, a single `SourcingEvent` may have more than one
`DecisionPackage` (e.g., Supplier A = 60, Supplier B = 40 against a
100-unit `RequestLine`), each independently progressing through its own
`DecisionPackage → Approval → PurchaseOrder` chain. This structure is
ratified here as valid and usable as-is. **It does not, by itself,
constitute or represent an authoritative "100 = 60 + 40" Allocation
fact** — no entity, field, or relationship in the current model
aggregates, validates, or certifies that such a set of DecisionPackages
correctly or completely covers a RequestLine's need.

**Evidence:** same independent assessment series as `DP-1`, including an
empirical, read-only verification run against the test database during
that series (two independent DecisionPackage→Approval→PurchaseOrder
chains created under one SourcingEvent, summing to a 100-unit
RequestLine, with zero schema/service error, then fully cleaned up).

**Scope:** Confirms only that the multi-DecisionPackage structure is
usable and that it does not itself constitute an Allocation fact. Does
not modify `RL-C1`–`RL-C4`, `QS-C1`, `QS-C2`, `CR-A`, `CR-B.1`, `CR-B.2`,
`APO-D1`, `APO-D2`, or `Q3` — all remain exactly as previously ratified.

**Explicit non-decisions:** whether such a set is commercially valid,
complete, over-, or under-covering (`Q3` items 4–7, still OPEN); whether
it requires a combined Approval (see `DP-3` Trigger B); any cardinality
rule beyond what already exists (`Q3` item 11, still OPEN); and any UI,
query, or reporting behavior for such a set. None of these may be
inferred from DP-2.

### DP-3 — Allocation Deferral

**Statement:** No new authoritative `Allocation` domain entity is
introduced into Procurement Core at this time. This is an explicit
deferral, not a rejection of the concept: `Allocation` (or an equivalent
authoritative aggregate across multiple `DecisionPackage`s) remains
available to be introduced later, if and when a concrete product or
domain requirement makes it necessary.

**Named triggers.** Any of the following, if and when it becomes a
concrete requirement, reopens the Allocation question for its own
independent future ratification:

- **Trigger A — Cross-decision quantity invariant.** A concurrency-safe,
  authoritative requirement that a set of DecisionPackages' selected
  quantities must (e.g.) not exceed a RequestLine's requested quantity
  (illustrative: 60+40 valid, 60+40+20 invalid).
- **Trigger B — Combined approval.** A business requirement for a single
  authoritative fact that an entire multi-supplier commitment (e.g., the
  full 100 units, not each 60/40 part separately) was approved together.
- **Trigger C — Revision / current-plan semantics.** A requirement to
  answer, at the aggregate level, "which generation/revision/requote is
  the current authoritative plan" once multiple such generations can
  exist under one SourcingEvent.

**Evidence:** same independent assessment series as `DP-1`/`DP-2`,
including cross-checks against `02-domain-model.md` §17's existing
"Historical Purchase" precedent (deferring a comparable new-aggregate
question until a concrete modeling need arises), the constitutional
principles in `01-system-principles.md` (#1, #2, #17 — AI is not system
of record; Procurement Core is the sole authoritative business state and
is authoritative for commercial facts), and `CR-C`'s existing
Recommendation ≠ Decision separation.

**Scope:** Establishes only that (a) Allocation is not added now, and
(b) the three named triggers are the explicit, recorded conditions under
which the question is reopened. Does not itself resolve any of the three
triggers, does not pre-select a model/shape for a future Allocation
entity, and does not modify any other ratified decision.

**Recommendation boundary:** `Recommendation → DecisionPackage` remains
the ratified shape; `Recommendation → Allocation → DecisionPackage` is
explicitly NOT ratified by this entry or any other. A future
Recommendation proposing a multi-supplier combination (e.g., 60 A + 40
B) does not, by itself, require or imply Allocation — the human decision
layer may translate such a proposal into multiple independent
`DecisionPackage`s, exactly as `DP-2` already describes.
`RecommendationRecord`'s own schema/cardinality (today single-QuoteVersion-
scoped) is unaffected by this entry and may be extended, if ever needed,
independently of whether Allocation is ever introduced.

**AI boundary:** consistent with `01-system-principles.md` principles
#1/#2/#17 and with `U3`/`B2`/`C`: if Allocation is ever introduced via a
future Trigger A/B/C ratification, its authoritative definition belongs
to Procurement Core, never to an AI Gateway or AI-facing component. The
anticipated future existence of AI-generated multi-supplier
recommendations is not itself a trigger and does not justify introducing
Allocation now.

**RFQ boundary:** RFQ fan-out to multiple suppliers (`R1`,
`SourcingEvent → RFQDispatch × N`) is a sourcing/communication-breadth
concept, independent of whether the resulting commercial decision is
single- or multi-supplier. RFQ reaching multiple suppliers does not, by
itself, constitute or require any of the three triggers.

**ERP boundary:** for simple multi-PurchaseOrder correlation under one
SourcingEvent (e.g., two POs resulting from a 60/40 split), the existing
`PurchaseOrder → Approval → DecisionPackage.sourcingEventId` chain is
sufficient for read-side grouping/correlation without Allocation.
Allocation is reopened for ERP purposes only if a future ERP integration
requires an authoritative, pre-validated combined-plan fact before
PurchaseOrders are created or transmitted — which is Trigger A or B, not
a distinct ERP-specific trigger.

**Explicit non-decisions:** DP-3 does not decide, resolve, or narrow any
of: multi-supplier allocation business policy; MOQ; undercoverage/
overcoverage; supplier substitution; one-Approval-many-PO (`Q3` item 11);
combined approval workflow mechanics; requote/revision policy;
DecisionPackage supersession mechanism; `RecommendationRecord` multi-line
schema; AI Gateway implementation; ERP integration semantics; Execution
Authority (`B2`); RLS; RFQ resend/revision policy; or any other item in
`docs/decisions/open.md`. All remain exactly as OPEN as before this
entry.

**Documentation note (observational only — not itself ratified or
corrected here):** `CT-A2`'s existing text refers to "the existing
`DecisionPackage.SUPERSEDED` lifecycle state." As of this ratification,
no `SUPERSEDED` value exists in `app/prisma/schema.prisma` or in any
service implementation — this entry records that observation for future
reference only; it does not correct, retract, or reinterpret `CT-A2`'s
text, and does not ratify `SUPERSEDED` as implemented or as a required
future mechanism.

