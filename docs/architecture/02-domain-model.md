# 02 — Domain Model

Status of this document: **mixed, per-section — see status labels throughout.**
This document is a **conceptual domain model**, not an implementation schema.
No database entity, table, column, cardinality enforcement, or persistence
mechanism is ratified by anything written here unless explicitly labeled
`RATIFIED`. Most of this document's content is either `DERIVED` from
already-ratified architecture, or `CONVERSATION-DERIVED BUSINESS
REQUIREMENT` (business clarifications given directly in conversation,
recorded here for the first time as canonical documentation), or
explicitly left as `EVIDENCE GAP` / `OPEN` / `PROPOSED — REQUIRES HUMAN
RATIFICATION`. See Section 22 for the exact meaning of each label.

---

## 1. Purpose

This document exists to record what is currently known — and explicitly
not yet known — about the core domain concepts of the YGT Procurement
System, so that future architecture, data-model, and implementation work
has a single, honest reference point. It exists specifically to close the
gap identified across the D-5.15 through D-5.19 analysis and business
clarification sequence: prior to this document, `ProductOrServiceReference`
(R2) had no recorded internal structure anywhere in this repository.

## 2. Scope

This document covers: canonical product/service identity and its
surrounding concepts (category, identity attributes, customer material
codes, packaging, manufacturer, brand, supplier identifiers); the
procurement-action domain (request, sourcing event, RFQ, quote, purchase
order) at a conceptual level; commercial conditions; quantity/unit
semantics; historical procurement context and price-trend semantics;
identity-matching semantics; the ProcurementMemory boundary; the
cancellation/successor-lineage boundary; and authority/AI boundaries as
they apply to all of the above. This document does **not** cover: database
schema, API contracts, UI/UX design, or the security enforcement matrix
(see `docs/security/enforcement-matrix.md` for the latter).

## 3. Relationship to Canonical Baseline

This document is subordinate to, and must never contradict:
`00-canonical-baseline.md`, `01-system-principles.md`,
`03-data-model.md`, `04-security-model.md`, `docs/decisions/ratified.md`,
`docs/decisions/derived.md`, `docs/decisions/open.md`, and
`docs/decisions/D-5-ratification-package.md`. Where this document appears
to add a new domain concept (e.g., Category, Identity Attribute
Definition), that concept is **new domain documentation**, not a new
architecture ratification — see the status labels on each concept
individually. Nothing in this document modifies R1–R14, M2, B2, C, U3 and
its 8 guardrails, the 29 constitutional principles, D5-R1, D5-R2,
D5-R3/R4's inactive status, R9, or any SEC-ID.

## 4. Domain Modeling Principles

- **Concept ≠ entity.** Every concept named in this document is a
  *conceptual* domain concept. Whether it becomes a distinct persisted
  database entity, an attribute of another entity, a derived/computed
  view, or something else entirely is **not decided here** — that is
  future data-modeling/implementation work, out of this document's scope.
- **Evidence over convenience.** Where prior analysis used words like
  "presumed," "likely," "possibly," or "by analogy," this document does
  **not** upgrade those into stated facts. They remain `EVIDENCE GAP` or
  `OPEN MODELING CHOICE` here.
- **Business requirement ≠ ratified architecture, except where formally
  elevated.** Q1–Q16 (given in conversation) remain the conversational/
  business-origin record for every principle in this document. A subset of
  that record has since been formally ratified as `PI-C1` through `PI-C11`
  in `docs/decisions/ratified.md` — those principles are labeled `RATIFIED
  — PI-C#` throughout this document, with their Q# origin preserved
  alongside for traceability. This does **not** mean every Q1–Q16 item is
  ratified, nor that every domain mechanism (category configuration,
  cardinalities, unit conversion, matching implementation, historical-
  context persistence, etc.) is resolved — those remain `OPEN`/`EVIDENCE
  GAP`/`PROPOSED — REQUIRES HUMAN RATIFICATION` exactly as before. The
  D-5.x cancellation-decision track (e.g., D5-R1) is a **separate**
  ratification track, distinct from PI-C1–PI-C11. See Section 22.
- **No universal mechanism invented.** Per U3, this document never
  proposes a universal Authority entity, a universal identity-matching
  algorithm, or a universal category schema applicable to all product
  types without qualification.

## 5. Core Domain Concepts

The following concepts are addressed in this document. Listing a concept
here is **not** a claim that it is, or must become, a database entity —
see Section 4's first principle, reinforced throughout Sections 6–14.

`ProductOrServiceReference` (Canonical Product) · Category · Identity
Attribute Definition · Identity Attribute Value · Customer Material Code /
SKU · Packaging Variant · Manufacturer · MPN · Brand · Supplier · Supplier
SKU · Procurement Request · Request Line (`RATIFIED — RL-C1`: a genuine
domain concept; a ProcurementRequest may contain multiple distinct
product/service lines — see §7) · Sourcing Event · RFQ / RFQDispatch ·
Quote · Quote Line · Purchase Order · PO Line · Selected Quantity
(`RATIFIED — QS-C1`: a business concept distinct from Quote quantity —
see §9) · Historical Purchase · Price Trend · ProcurementMemory ·
Historical Context · Successor Lineage.

---

## 6. Product Identity

### 6.1 Canonical Product

**Definition:** the identity meant by "the same thing we are buying" —
the concept `ProductOrServiceReference` names.

**Role:** the single canonical reference point for all product-identity
questions in Procurement Core.

**Authority:** Core-authoritative (RATIFIED — R2).

**Evidence:** R2 (`docs/decisions/ratified.md`, line 16): *"`ProductOrServiceReference`
is canonical within Procurement Core; ERP-side product/service mappings are
external to that canonical reference, not a replacement for it."* This is
the entire textual ratified content on this concept.

**Lifecycle status:** `EVIDENCE GAP` — mutability, versioning, and
revision behavior are not established (see Section 17, Section 18).

**Unresolved semantics:** whether "ProductOrServiceReference" is itself the
canonical identity object, or a reference/pointer to one defined elsewhere,
remains `EVIDENCE GAP` (this ambiguity was first raised in D-5.17 and is
not resolved by any business clarification since — Q1–Q16 clarify what
counts as *the same* canonical product, not the structural nature of the
reference concept itself).

### 6.2 Category

**Definition:** the classification that determines which attributes are
identity-defining for a given product.

**Role:** `RATIFIED — PI-C1` (Q2, Q14 — conversational origin) — product
identity is category-specific; there is no universal fixed
identity-attribute list across all product types. Additionally, `RATIFIED
— PI-C4` (Q14): both YGT-provided category templates and
customer/domain-expert-defined categories are supported authorship
sources.

**Authority:** The **authorship-source principle** (YGT-provided and
customer/domain-expert-defined categories both permitted; AI may not
author a category's identity-attribute definition unilaterally — this AI
boundary is `DERIVED` from R12/AI-not-authoritative, applied to this new
concept) is `RATIFIED — PI-C4`. The **technical mechanism** — a shared
registry, a per-tenant copy-on-customize model, ownership, versioning,
effective dating, inheritance, global-vs-tenant-specific reference data,
conflict resolution, or authorization mechanics — remains `OPEN` /
`PROPOSED — REQUIRES HUMAN RATIFICATION`, unresolved by PI-C4. See Section
12, Section 19.

**Evidence:** `RATIFIED — PI-C1`, `RATIFIED — PI-C4` (Q2, Q7, Q14 —
conversational origin) — no repository file mentioned "category" in this
sense prior to this document's initial drafting; the principle is now
formally ratified in `docs/decisions/ratified.md`.

**Lifecycle status:** `EVIDENCE GAP` — versioning/effective-dating of a
category's identity-attribute definition over time is not established.

### 6.3 Identity Attributes

**Definition:** the specific attributes a category declares as
identity-defining (e.g., for the example metal category: grade, main
measure, length, width, thickness, diameter, tolerance, surface finish,
color, technical quality standard, technical/performance specification —
`RATIFIED — PI-C1`, Q2/Q7 — conversational origin, given explicitly as an
*example category's* definition, not a universal list).

**Context-dependent attributes** (identity-relevance varies by category,
per Q7): weight, unit, packaging type, packaging quantity, country of
origin. `RATIFIED — PI-C1` that these are context-dependent; `OPEN`
exactly which categories treat which of these as identity-relevant.

**Non-identity attributes** (never identity-defining in any category
tested so far, per Q7/Q10/Q11): manufacturer, MPN, supplier SKU, supplier,
brand. `RATIFIED — PI-C2.` These remain visible as informational/provenance
metadata (Sections 6.6–6.9) even though they never participate in identity
matching.

**Authority:** Core-confirmed once a category's attribute definition
exists; AI may only propose candidate attributes (`DERIVED`, R12/AI-not-
authoritative).

**Evidence:** `RATIFIED — PI-C1`, `RATIFIED — PI-C2` (Q2, Q7 — conversational origin).

**Unresolved semantics:** the exact value-type model for an identity
attribute (numeric with unit, enumerated, free text, etc.) is `EVIDENCE
GAP` — not addressed by any business clarification to date.

### 6.4 Customer Material Code / SKU

**Definition:** a customer-facing procurement reference/identifier.

**Role:** `RATIFIED — PI-C5` (Q1 — conversational origin) — a customer material code
or SKU is **not** necessarily identical to canonical product identity. One
canonical product may be referenced by multiple customer material
codes/SKUs (see Section 6.5's packaging example, Q9).

**Authority:** not itself authoritative for product identity; it is a
customer/procurement-facing reference layer above the canonical identity.

**Evidence:** `RATIFIED — PI-C5` (Q1, Q9 — conversational origin). No
repository evidence prior to this document addressed material codes at
all (confirmed by exhaustive search in D-5.18).

**Lifecycle status:** `EVIDENCE GAP.`

### 6.5 Packaging

**Definition:** a packaging-specific procurement variant under one
canonical product.

**Role:** `RATIFIED — PI-C6` (Q9, Q16 — conversational origin) — a packaging change
does **not** automatically mean a different canonical product. Example:
Canonical Product A may have Packaging A → Customer Material Code A and
Packaging B → Customer Material Code B, with the canonical product
unchanged but **separate price histories** maintained per packaging
variant. Default display shows the current packaging/material code's
history first; other packaging variants remain separately
accessible/filterable under the same canonical product.

**Authority:** the canonical product's identity is Core-authoritative and
unaffected by packaging; the packaging-variant-to-price-history
association is a business requirement whose persistence model is not
decided (Section 13, Section 16).

**Evidence:** `RATIFIED — PI-C6` (Q9, Q16 — conversational origin).

**Unresolved semantics (explicitly not fixed, per instruction):**
Packaging Variant ↔ Customer Material Code cardinality is `OPEN MODELING
CHOICE` — whether one packaging variant maps to exactly one customer code
or possibly several is not established.

### 6.6 Manufacturer

**Definition:** the entity that physically produces the product.

**Role:** `RATIFIED — PI-C2` (Q10 — conversational origin) — manufacturer is **never**
identity-defining. A manufacturer change does not create a different
canonical product if the identity-defining specification is otherwise
unchanged (e.g., Manufacturer A → Product X and Manufacturer B → Product X
may be the same canonical product). Historical purchase data remains
associated with the same canonical product independently of manufacturer,
while the historical display still shows which manufacturer was involved
in that specific historical PO.

**Authority:** informational/provenance only; never contributes to
identity matching.

**Evidence:** `RATIFIED — PI-C2` (Q10 — conversational origin).

**Unresolved semantics:** Product ↔ Manufacturer cardinality over time is
`OPEN MODELING CHOICE` — not fixed as one-to-many, many-to-many, or any
other specific shape.

### 6.7 MPN (Manufacturer Part Number)

**Definition:** a manufacturer-specific identifier for a product.

**Role:** `RATIFIED — PI-C2` (Q7 — conversational origin) — MPN is **not**
authoritative canonical product identity. MPN equality does not imply
same canonical product, and MPN difference does not imply different
canonical product, without further corroborating evidence.

**Authority:** non-authoritative signal only; may be used as a weak
candidate-matching input (Section 12), never as an identity-establishing
fact.

**Evidence:** `RATIFIED — PI-C2` (Q7 — conversational origin).

### 6.8 Brand

**Definition:** a marketing/commercial brand associated with a product.

**Role:** `RATIFIED — PI-C2` (Q11 — conversational origin) — brand is **not** part of
canonical product identity, but must remain visible as informational
product/procurement context. It must not be discarded merely because it
is not identity-defining.

**Authority:** informational only.

**Evidence:** `RATIFIED — PI-C2` (Q11 — conversational origin).

**Unresolved semantics:** Product ↔ Brand cardinality is `OPEN MODELING
CHOICE`, by the same reasoning as manufacturer (Section 6.6) — not
explicitly stated by the business owner, only inferable by analogy, which
this document does not upgrade to a fixed rule.

### 6.9 Supplier / Supplier SKU

**Definition:** Supplier — the commercial source a product can be procured
from. Supplier SKU — a supplier-specific identifier for a product.

**Role (Supplier):** `RATIFIED` — supplier identity is governed by R3
(staged supplier identity resolution, no silent fuzzy merges) and
Document 03's supplier relationship classification
(NEW/EXISTING/HISTORICAL/UNKNOWN) and `is_verified_strong` flag. Supplier
identity is a **distinct concept from product identity** — R3's rules
govern suppliers, and are not automatically transferred to products (this
non-transfer is itself an explicit finding, reaffirmed here, not a new
rule).

**Role (Supplier SKU):** `RATIFIED — PI-C2` (Q4, Q7 — conversational origin) —
supplier SKU is **not** canonical product identity. Supplier SKUs are
supplier-specific; two different suppliers' differing SKUs for the same
underlying specification do not imply different products, and a
supplier's own SKU change does not automatically create a new canonical
product. Two different suppliers offering the same fully-matching
specification (`RATIFIED — PI-C2`, Q4) may be treated as the
same canonical product with different price sources — but packaging or
packaging-quantity differences (e.g., 100g vs. 125g) still produce
separate price histories even under one canonical product and one
supplier relationship (Q4, Section 6.5).

**Evidence:** Supplier — R3, `03-data-model.md` supplier model section.
Supplier SKU — `RATIFIED — PI-C2` (Q4, Q7 — conversational origin).

---

## 7. Procurement Domain

*(Conceptual only — no cardinality with Category/Product concepts fixed
beyond what is stated; see Section 14, Section 15.)*

### 7.1 Procurement Request

**Definition:** the business-action-initiating record for a procurement
need. **Evidence:** `DERIVED` from the lifecycle sketch in
`00-canonical-baseline.md` (itself explicitly marked as a non-ratified,
non-implementation-contract sketch). **Authority:** Core-authoritative.
**Lifecycle:** `EVIDENCE GAP` on specific mutability rules beyond the
general Document 03 immutability pattern.

**Multi-line:** `RATIFIED — RL-C1` — a ProcurementRequest may contain
multiple distinct product/service lines. Exact line cardinality/schema
remains `OPEN` (see the "Request Line / Quote Line / PO Line" section
below).

### 7.2 Sourcing Event

**Definition:** the parent aggregate for one or more RFQ dispatches.
**Evidence:** `RATIFIED` — R1 (`SourcingEvent + RFQDispatch × N`).
**Authority:** Core-authoritative.

**Line-level independence:** `RATIFIED — RL-C2` — each Request Line is
sourced through its own independent SourcingEvent; a single SourcingEvent
does not span multiple distinct Request Lines within the same
ProcurementRequest. R1's `SourcingEvent → RFQDispatch × N` fan-out (to
suppliers) is unchanged and operates *within* one line's sourcing scope.

**Active concurrency:** `RATIFIED — RL-C3` — at most one currently-active
SourcingEvent may exist for a given Request Line at a time. **This
concerns active-state concurrency only** — it does not mean exactly one
SourcingEvent for the lifetime of a Request Line, does not establish a
historical one-to-one cardinality, and does not authorize or forbid
re-sourcing. Whether a new SourcingEvent may be created for the same line
after an earlier one becomes terminal (e.g., cancelled or completed)
remains `OPEN` and interacts with D5-R2, itself still `OPEN`.

### 7.3 RFQ / RFQDispatch

**Definition:** a supplier-facing sourcing request under a Sourcing Event.
**Evidence:** `RATIFIED` — R1. **Authority:** Core-authoritative.

### 7.4 Quote

**Definition:** a supplier's response to an RFQ. **Evidence:** `RATIFIED`
— R11 (evidence pipeline governs validation), `03-data-model.md`
(`quote_version`, immutable once created). **Authority:** Core-
authoritative once validated through the R11 pipeline.

**Partial quantity:** `RATIFIED — RL-C4` — a supplier may quote a quantity
smaller than the requested quantity; such a quote is not inherently
invalid. Its validity is determined by applicable commercial/business
rules (not specified here). **This does not imply:** that the quote is
approved, that it determines PO quantity, that it authorizes split
sourcing or automatic supplier combination, or that any automatic PO
splitting occurs. MOQ, stock rules, commercial validation criteria, and
unit conversion all remain `OPEN`.

### 7.5 Purchase Order

**Definition:** the commercial order record. **Evidence:** `RATIFIED` —
`03-data-model.md` ("PurchaseOrder is immutable once SENT"). **Authority:**
Core-authoritative; ERP-side transaction/fulfillment state is separately
authoritative for the ERP's own domain (R4).

### Request Line / Quote Line / PO Line

**Request Line — existence:** `RATIFIED — RL-C1`. A ProcurementRequest may
contain multiple distinct product/service lines, and Request Line is a
genuine business concept. **Still `OPEN`:** exact cardinality/schema,
PK/FK structure, minimum/maximum line count, RequestLine lifecycle, and
the `ProductOrServiceReference` ↔ Request Line relationship (whether each
line references exactly one canonical product or some other shape).

**Quote Line — existence/structure:** `EVIDENCE GAP` / `OPEN`, unchanged.
No business clarification has addressed whether Quote Line exists as a
concept, and none is inferred from RL-C1–RL-C4.

**PO Line — existence/structure:** `EVIDENCE GAP` / `OPEN`, unchanged. Same
reasoning as Quote Line.

Quote Line and PO Line cardinality, and their relationship to Request
Line (if any), remain fully `OPEN` — none of this is resolved by RL-C1.

---

## 8. Commercial Conditions

**Definition:** MOQ, lead time, payment terms, Incoterms, delivery
location, and other quote-specific commercial terms.

**Role:** `RATIFIED — PI-C7` (Q13 — conversational origin) — none of these are
canonical product identity. They are attributes of a **commercial
interaction** (a specific quote or PO), never of the product itself. The
same canonical product can carry different commercial conditions across
different suppliers or different points in time without any implication
for its identity.

**Evidence:** `RATIFIED — PI-C7` (Q13 — conversational origin).

---

## 9. Quantity and Unit Semantics

**Four independent points**, confirmed distinct and not to be collapsed
(`RATIFIED — PI-C8`, Q12 — conversational origin):

1. **Request quantity/unit** — what the requester asks for (e.g., "1
   piece").
2. **Quote quantity/unit** — what the supplier quotes against (e.g., "50
   kg").
3. **Pricing unit** — the basis the price is expressed in (e.g., "TRY/kg"
   — may differ from the quote's own quantity unit).
4. **PO quantity/unit** — what is actually ordered.

**Role:** unit/quantity is `RATIFIED — PI-C8` (Q7, Q12 — conversational
origin) to be **context-dependent, not universally identity-defining** —
unit may participate in product identity for some categories, when that
category's identity definition explicitly makes it identity-relevant
(§6.3), but it is never identity-defining by default across all
categories.

**Cross-unit comparison requirement:** the price-trend weighted-average
calculation (Section 11) requires reconciling quantities that may be
expressed in different units across historical records. **The
conversion/normalization authority and mechanism is `EVIDENCE GAP` /
`OPEN MODELING CHOICE`** — not addressed by any business clarification to
date. No conversion algorithm or authority is proposed here.

**Selected Quantity:** `RATIFIED — QS-C1` — the quantity the procurement
decision-maker chooses to pursue from a supplier quote (or, if
multi-supplier combination is later ratified under D1, from one or more
supplier quotes) is a business concept distinct from Quote quantity
above. **This establishes only the concept's existence and its
distinctness from Quote quantity.** It does not establish: whether
Selected Quantity may differ from Quoted Quantity in either direction
(`OPEN` — D3); whether Ordered Quantity must equal the quantity Approval
authorizes (`OPEN` — Q3); coverage-acceptance policy (`OPEN` — D6);
shortfall/remaining-quantity resolution (`OPEN` — D4); or any persistence
location, schema, or entity for this concept (`OPEN`, unaffected by
QS-C1). Approved Quantity, Ordered Quantity, and Fulfilled Quantity
remain unnamed business concepts — `EVIDENCE GAP`, not addressed by
QS-C1.

**Approval authorization of Selected Quantity:** `RATIFIED — QS-C2` — the
conceptual chain is:

```
Requested Quantity → Quoted Quantity → Selected Quantity →
Approval authorization of the Selected Quantity represented in the
frozen DecisionPackage
```

Approval (M2: historical, tenant-level, INSERT-only) authorizes the
Selected Quantity exactly as represented in the frozen DecisionPackage
(`03-data-model.md`'s existing "frozen DecisionPackage" reference).
**There is no independent Approved Quantity business concept under
QS-C2** — Approval does not act as a commercial redrafting operation
that changes the Selected Quantity; if a decision-maker wants a
different quantity, that is not resolved by QS-C2 and remains subject to
whatever future revision/new-decision mechanism is eventually ratified.
QS-C2 does not alter M2, B2, or the existing "frozen DecisionPackage"
language, and does not imply anything about Ordered Quantity, PO
creation, ERP quantity, or fulfillment quantity — all remain `OPEN` /
`EVIDENCE GAP` exactly as before (Q3, D1–D7, Approval→PO cardinality,
DecisionPackage→PO cardinality, QuoteLine, PO Line, and quantity
allocation are all unaffected by QS-C2).

---

## 10. Historical Procurement Context

Four categories, kept explicitly and strongly separated
(`RATIFIED — PI-C9`, Q5 — conversational origin, reinforced across
D-5.15–D-5.19, unchanged here):

- **Current validated commercial facts** — governed entirely by R11's
  evidence pipeline (Source → CapturedEvidence → AI Extraction →
  StructuredClaim → Validation → PersistedClaim). `RATIFIED.`
- **Historical purchase facts** — approved/realized PO history. Presented
  as dated, labeled historical context, never as current evidence.
  `RATIFIED — PI-C9` (Q5).
- **Historical price trend** — a derived analytic computed over historical
  purchase facts (Section 11). Never itself a fact; always a computation.
  `RATIFIED — PI-C9` (Q15).
- **Historical context (the relevance relationship)** — the act of
  presenting historical purchase facts/trends alongside a *new* action's
  current facts, to inform (never substitute for) the current decision.
  This relevance relationship is itself `OPEN` as to its persistence
  mechanism — see Section 17.

**ProcurementMemory** is the conceptual home for the derived/contextual
intelligence layer that summarizes and surfaces this historical
information (`RATIFIED` — R8). It is never authoritative current truth,
never establishes identity, and never replaces current evidence (R8, R11,
R12, unchanged).

**Successor lineage is not this.** Historical context is a **completely
separate relationship** from successor lineage (D5-R2) — see Section 14.

### 10.1 Historical Supplier Quote Context (distinct from Historical Purchase Price Trend)

`RATIFIED — PI-C9` establishes that historical procurement context
actually contains **two separate concepts**, not one undifferentiated
"history" bucket:

- **(A) Historical Purchase Price Trend** — see Section 11: derived
  strictly from purchases that resulted in an approved/issued/completed
  PO, aggregated by quarter (current year) or annual average (prior
  years).
- **(B) Historical Supplier Quote Context** — a **separate concept**:
  historical supplier quotes that did **not** necessarily result in a PO,
  retained as contextual information rather than discarded. This is
  especially relevant when the **same supplier** is selected again in a
  later, independent sourcing action — the system may surface that
  supplier's prior quotes (PO-converted or not) from earlier sourcing
  actions as context for the new one. Historical Supplier Quote Context
  must **never** be folded into, or allowed to contaminate, the Historical
  Purchase Price Trend (A).

**Four concepts that must remain distinguishable** (per PI-C9), illustrated
with the ratified worked example: Supplier B previously quoted 185 TRY/kg,
later received a PO at 200 TRY/kg, later quoted 205 TRY/kg without
receiving a PO, and later received a PO at 210 TRY/kg. If Supplier B is
selected again for a new sourcing event, these four remain separate:

1. **Current validated quote** — e.g., 214 TRY/kg (this action's own R11
   evidence).
2. **Historical purchase price** (from Supplier B specifically) — e.g.,
   210 TRY/kg, the last PO-converted price.
3. **Historical non-PO supplier quote** (from Supplier B specifically) —
   e.g., 205 TRY/kg, retained as Historical Supplier Quote Context, never
   treated as a purchase.
4. **Overall canonical-product Historical Purchase Price Trend** — the
   quarterly/annual aggregation from Section 11, derived from qualifying
   PO purchases only, across all suppliers.

**Does not decide (per PI-C9's own scope boundary, unchanged here):** the
exact unit-normalization mechanism, cross-unit comparison algorithm, exact
aggregation implementation, treatment of abnormal/outlier purchases, exact
storage model, or exact supplier-history query implementation. No new
database entity is implied by naming this concept — see Section 4's
concept-≠-entity principle.

---

## 11. Price Trend Semantics

**Status: `RATIFIED — PI-C9`** (Q15 — conversational origin) — this is a firm
business rule, not a configurable/overridable policy. See Section 10.1 for
the companion Historical Supplier Quote Context concept, which this trend
must never be contaminated by.

- **Current calendar year:** for each quarter (Q1–Q4), the trend surfaces
  (a) the full list of actual purchases/approved POs in that quarter for
  the canonical product, then (b) a quantity-weighted average price.
  Worked example (given by the business owner): 500 kg @ 190 TRY/kg +
  2,000 kg @ 200 TRY/kg → weighted average of 198 TRY/kg.
- **Previous calendar years:** an annual average price only (no quarterly
  breakdown required for prior years).
- **Critical exclusion, `RATIFIED — PI-C9`:** supplier quotes
  that never became an approved PO are **excluded** from this trend
  calculation entirely. They may still be shown as current
  sourcing/Decision-Package context and/or as Historical Supplier Quote
  Context (Section 10.1) but never folded into the historical trend
  number.

**EVIDENCE GAP, explicitly carried forward:** the unit/quantity
normalization basis needed to produce one comparable weighted-average
figure across historical records that may use different units or
packaging (Section 9) is not established. This gap does not weaken the
business rule itself — it is a computation-mechanism gap, not a policy
gap.

---

## 12. Matching and Identity Resolution

| Class | Establishes identity? | AI role | Status |
|---|---|---|---|
| Authoritative (same canonical product) | Yes | N/A | `RATIFIED` (R2) |
| Deterministic candidate (same category + same identity-defining attribute values) | Yes, once Core-confirmed | May propose | Principle that this class exists: `RATIFIED — PI-C1`, `RATIFIED — PI-C10` (Q2/Q6/Q7 — conversational origin). Mechanism: `PROPOSED — REQUIRES HUMAN RATIFICATION`, unresolved |
| AI semantic similarity | No | Proposal only | `RATIFIED` foreclosure (R12/AI-not-authoritative) |
| Textual similarity | No | Weakest-tier proposal | `RATIFIED` foreclosure (R12) |
| Supplier-declared equivalence | No | Untrusted external claim | `RATIFIED` foreclosure (untrusted-external-content principle) |
| Supplier SKU similarity | No | Weak signal only | `RATIFIED — PI-C2` foreclosure (Q4, Q7 — conversational origin) |
| MPN similarity | No | Weak signal only | `RATIFIED — PI-C2` foreclosure (Q7 — conversational origin) |
| Manual History Search | Not an identity mechanism at all | N/A | `RATIFIED — PI-C11` (Q8 — conversational origin) — a user-initiated, broader search whose results must be clearly labeled and never silently presented as the same product |

**AI may:** propose candidate matches, propose identity-attribute
suggestions for a category, and propose historical-relevance suggestions.

**AI may never:** establish canonical identity, or establish historical
relevance as an authoritative fact. Core confirmation is required in
every case (`RATIFIED` via R12 and the AI-not-authoritative principle,
applied consistently to this new domain area).

**Both failure modes are business-critical** (`RATIFIED — PI-C10`,
Q6 — conversational origin): a false positive (showing a different product's history
as if it were the current product's) and a false negative (missing
genuinely relevant history) are both considered serious. Matching
therefore **cannot** be resolved by adjusting a single AI-confidence
threshold — this is an explicit business constraint on any future
matching-mechanism design, not merely a preference.

---

## 13. ProcurementMemory

Unchanged from R8 and every prior D-5.1x finding: derived/contextual
intelligence, carries freshness metadata, never authoritative current
truth, never establishes identity, never replaces evidence, never becomes
Approval or DecisionPackage. `RATIFIED` (R8). This document adds no new
capability or constraint to ProcurementMemory beyond applying its existing
boundary to the newly-documented product-identity and historical-context
concepts above.

---

## 14. Cancellation and Successor Lineage Boundary

**D5-R1 (RATIFIED, Option B — Permanent Cancellation)** and **D5-R2 (OPEN,
narrow cancellation-triggered successor lineage)** are unaffected by this
document. Specifically preserved:

- A cancelled business action's historical procurement-fact value is
  **not** erased by its cancellation — cancellation terminates only the
  action's *operative* lifecycle (D5-R1), while its historical record
  remains available as historical context (Section 10), consistent with
  Document 03's general immutability pattern.
- **Successor lineage** (D5-R2) means only: an explicit, cancellation-
  triggered continuation link between a specific cancelled predecessor
  business action and a specific new successor business action. This
  remains `OPEN`, exactly as recorded in `docs/decisions/open.md` and
  `docs/decisions/D-5-ratification-package.md` — **not broadened by this
  document.**
- **Historical procurement context** (Section 10) is a **completely
  independent relationship**: it can exist between any new business action
  and any prior procurement record for the same canonical product,
  regardless of whether any action was ever cancelled, completed, or
  otherwise concluded, and regardless of whether any successor-lineage
  relationship exists or is ever ratified. Neither relationship is a
  special case of the other, and this document does not model them as
  such.

---

## 15. Authority and AI Boundary

Per U3 (RATIFIED, unchanged): no universal Authority entity, no generic
authorization service, no universal identity-establishment API is
introduced anywhere in this document. Every domain concept's authority
boundary is stated individually (Sections 6–14) in terms of: who/what
authoritatively owns the concept (Core, in every case examined), where
customer/domain-expert input is accepted (category and identity-attribute
definitions, Section 6.2/6.3), and where AI may only propose, never
establish (identity matches, attribute suggestions, historical relevance
— Section 12). This is domain-specific documentation of existing
principles (U3, R12, AI-not-authoritative), not a new authority mechanism.

---

## 16. Tenant Boundary

The general tenant-isolation principle itself remains `RATIFIED` (Document
03 / constitutional principles). Its **application** to the newly
introduced customer-specific concepts documented in this file (products as
procured by a given tenant, customer material codes, historical purchases,
price trends, ProcurementMemory outputs, supplier relationships,
procurement actions) is `DERIVED` — it follows from the ratified
tenant-isolation principle when applied to these newly introduced
customer-specific concepts; the concepts themselves were not individually
named in the original ratification. **`OPEN`:** whether YGT-provided global category
templates, customer-defined category templates, and any global
manufacturer/brand master data are tenant-scoped, globally shared, or some
hybrid is not established and is not decided here.

---

## 17. Lifecycle and Mutability

| Concept | Immutable historical fact? | Mutable reference data? | Derived? | Status |
|---|---|---|---|---|
| Approval, Quote (version), PO (once SENT) | Yes | — | — | `RATIFIED` (existing Document 03) |
| Historical Purchase (as a concept) | Represented by/derived from authoritative PO history | — | Arguably both, depending on modeling choice | `OPEN MODELING CHOICE` — see explicit note below |
| Canonical Product identity over time / revisions | `EVIDENCE GAP` | `EVIDENCE GAP` | — | Unresolved (Section 18) |
| Category / Identity Attribute Definition | — | Likely, but not confirmed | — | `EVIDENCE GAP` |
| Price Trend | — | — | Yes, always computed | `RATIFIED — PI-C9` (Section 11) |
| ProcurementMemory | — | — | Yes, always derived | `RATIFIED` (R8) |

**Explicit note on Historical Purchase:** the business requirement is that
past approved-PO details be shown as historical context (Section 10). This
does **not** by itself require a separate persisted "Historical Purchase"
entity distinct from the PO record itself. **Historical Purchase is best
understood, at this stage, as: a conceptual historical fact derived from
and represented by the authoritative PO history — not a confirmed separate
entity.** Whether a distinct table/entity is warranted is `OPEN MODELING
CHOICE`, deferred to future data-modeling work.

---

## 18. Known Evidence Gaps

1. Whether `ProductOrServiceReference` is itself the canonical identity
   object or a pointer to one defined elsewhere (Section 6.1).
2. Category/Identity-Attribute-Definition ownership and versioning
   mechanism (Section 6.2, Section 12, Section 19).
3. Request Line's exact cardinality/schema, and the `ProductOrServiceReference`
   ↔ Request Line relationship — Request Line's *existence* itself is
   `RATIFIED — RL-C1`, but its exact shape is not (Section 7). Quote Line
   and PO Line existence/structure/cardinality remain entirely `OPEN`,
   unaffected by RL-C1 (Section 7).
4. Packaging Variant ↔ Customer Material Code exact cardinality (Section
   6.5).
5. Product ↔ Manufacturer and Product ↔ Brand cardinality over time
   (Section 6.6, 6.8).
6. Unit/quantity conversion authority and mechanism for price-trend
   weighted averaging (Section 9, Section 11).
7. Whether "supersedes"/"replaced-by"/specification-lineage relationships
   are needed between an old canonical product and a new one created by a
   specification change (Section 18 below, restated per Section 18's own
   numbering — see Section "Product Revision / Supersedes").
8. Historical Context persistence mechanism — query-time computation vs.
   Core-confirmed persisted relationship (Section 17's "Explicit note,"
   Section 19 below).
9. Tenant ownership of shared/global reference data (categories,
   manufacturer/brand masters) — Section 16.

### Product Revision / Supersedes (explicit sub-section per instruction)

`RATIFIED — PI-C3` (Q2/Q3 — conversational origin): a change to an
identity-defining specification (e.g., 316/10mm vs. 316/12mm) creates a
**different canonical product**, not a revision of the same one. What
remains **`OPEN`** is whether the
domain model needs any explicit relationship (supersedes, replaced-by,
related-product, specification-lineage) connecting the old canonical
product to the new one. Manual History Search (Section 12) can serve this
need informally today — a user can manually find the related older
product's history — but this may become a formal domain-model requirement
in the future. This document takes no position on whether it will.

---

## 19. Open Modeling Decisions

Each listed with its required status label, per Section 24's instruction
that none of these become ratified by virtue of appearing in this
document:

- **Category/attribute-set declaration mechanism** (shared registry vs.
  per-tenant customizable copy vs. other) — `PROPOSED — REQUIRES HUMAN
  RATIFICATION` (see D-5.19 Section 14 for the specific proposal,
  alternatives, and impact analysis; not re-ratified here).
- **Historical Context persistence** — Option A (query-time deterministic
  matching, no persisted relationship) vs. Option B (Core-confirmed
  persisted historical-relevance relationship) — `OPEN — REQUIRES HUMAN
  RATIFICATION`. AI suggestion alone is insufficient under either option
  (R12).
- **Deterministic-matching implementation mechanism** (how "same category
  + same identity-defining attribute values" is actually represented and
  computed) — `OPEN MODELING CHOICE`.
- **Unit conversion authority** (Section 9, Section 11) — `EVIDENCE GAP` /
  `OPEN MODELING CHOICE`.
- **Product revision/supersedes relationship** (Section 18) — `OPEN`.
- **Request Line exact cardinality/schema, and `ProductOrServiceReference`
  ↔ Request Line relationship** (Section 7) — `OPEN` (Request Line's
  *existence* is no longer part of this item — that is `RATIFIED —
  RL-C1`).
- **Quote Line existence/cardinality** (Section 7) — `EVIDENCE GAP`,
  unaffected by RL-C1–RL-C4.
- **PO Line existence/cardinality** (Section 7) — `EVIDENCE GAP`,
  unaffected by RL-C1–RL-C4.
- **Packaging Variant ↔ Customer Material Code cardinality** (Section 6.5)
  — `OPEN MODELING CHOICE`.
- **Category/reference-data tenant ownership** (Section 16) — `OPEN`.

## 20. Non-Goals

This document does not: define database schema, tables, columns, indexes,
or constraints; define API contracts; define UI/UX presentation details
beyond the business rules already stated (e.g., "current packaging history
shown first"); resolve any item listed in Section 18/19; or ratify any
architecture decision. Sections 6–14's business-requirement content is
ready to inform future data-modeling work; it is not that work itself.

## 21. Traceability

| Rule / Concept | Source | Formal Ratification |
|---|---|---|
| ProductOrServiceReference canonical, ERP mappings external | R2, `docs/decisions/ratified.md` | R2 |
| Supplier staged identity, no fuzzy merges | R3 | R3 |
| Core/ERP authority split | R4 | R4 |
| ProcurementMemory derived/freshness | R8 | R8 |
| RFQ = SourcingEvent + RFQDispatch × N | R1 | R1 |
| Evidence pipeline | R11 | R11 |
| Confidence ≠ evidence | R12 | R12 |
| Approval INSERT-only, immutable | M2, Document 03 | M2 |
| PO immutable once SENT, Quote versioning | Document 03 | Document 03 |
| P1 permanent cancellation | D5-R1, `docs/decisions/ratified.md` | D5-R1 |
| Successor lineage narrow scope | D5-R2, `docs/decisions/open.md`, `docs/decisions/D-5-ratification-package.md` | — (D5-R2 still OPEN) |
| Customer material code ≠ canonical identity | Q1 — conversational origin | PI-C5 |
| Category-specific identity, example attribute list | Q2, Q7 — conversational origin | PI-C1 / PI-C3 |
| Specification change ⇒ different canonical product | Q3 — conversational origin | PI-C3 |
| Supplier boundary / price comparison across suppliers | Q4 — conversational origin | PI-C2 |
| Historical context = full approved-PO detail + price trend | Q5 — conversational origin | PI-C9 |
| Both false-positive and false-negative matching risk are critical | Q6 — conversational origin | PI-C10 |
| Identity/context/non-identity attribute classification | Q7 — conversational origin | PI-C1 / PI-C2 / PI-C3 / PI-C8 |
| Manual History Search for different-specification products | Q8 — conversational origin | PI-C11 |
| Packaging variant / separate price history | Q9, Q16 — conversational origin | PI-C6 |
| Manufacturer non-identity, historical display | Q10 — conversational origin | PI-C2 |
| Brand non-identity, visible metadata | Q11 — conversational origin | PI-C2 |
| Request/quote/pricing/PO unit independence | Q12 — conversational origin | PI-C8 |
| Commercial/procurement conditions ≠ product identity | Q13 — conversational origin | PI-C7 |
| Category definitions: YGT + customer-defined, AI non-authoritative | Q14 — conversational origin | PI-C4 |
| Price trend: quarterly/annual, PO-only exclusion | Q15 — conversational origin | PI-C9 |
| Packaging history display order | Q16 — conversational origin | PI-C6 |

| Decision | Source | Formal Ratification | Domain |
|---|---|---|---|
| Multi-line ProcurementRequest / Request Line existence | BC-1 | RL-C1 | Request / Line |
| Independent line-level sourcing | BC-2 | RL-C2 | Request / Sourcing |
| One active SourcingEvent per Request Line (concurrency only) | BC-2 | RL-C3 | Request / Sourcing |
| Partial quote not inherently invalid | BC-3 | RL-C4 | Quote / Quantity |
| Selected Quantity is a distinct business concept from Quoted Quantity | Q1 Human Ratification Preparation | QS-C1 | Quantity Semantics |
| Approval authorizes Selected Quantity as represented (no independent Approved Quantity) | Q2 Human Ratification Preparation | QS-C2 | Quantity Semantics |

The **Source** column preserves each rule's conversational/business-origin
record (Q1–Q16) and is never removed. The **Formal Ratification** column
records the corresponding `docs/decisions/ratified.md` entry, where one
exists. A `PI-C#` mapping here is a traceability reference only — it does
not close any implementation-level OPEN question associated with that
principle (see Sections 18–19 for what remains open in each case).

---

## 22. Status Labels (definitions, as used throughout this document)

- **RATIFIED** — a formally ratified architecture/business decision
  (e.g., R2, D5-R1).
- **RATIFIED BUSINESS REQUIREMENT** — a business rule the user explicitly
  and firmly established within the Q1–Q16 clarification round (e.g., the
  price-trend PO-only exclusion rule, Q15).
- **DERIVED** — a logical consequence of ratified principles, not itself
  separately ratified.
- **CONVERSATION-DERIVED BUSINESS REQUIREMENT** — a requirement stated in
  conversation, not yet reflected anywhere else in repository canonical
  documentation prior to this document, and not held to the same firmness
  as a `RATIFIED BUSINESS REQUIREMENT` (i.e., understood as clarified
  business intent, but not marked as an unchangeable rule the way Q15's
  exclusion rule is).
- **EVIDENCE GAP** — existing sources do not answer the question.
- **OPEN** / **OPEN MODELING CHOICE** — genuinely unresolved; requires
  either further business input or a future modeling/architecture
  decision.
- **PROPOSED — REQUIRES HUMAN RATIFICATION** — a solution this document
  (or its preparatory audits) suggests, which cannot enter the
  architecture baseline without explicit human approval.
