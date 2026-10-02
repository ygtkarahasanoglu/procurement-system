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
