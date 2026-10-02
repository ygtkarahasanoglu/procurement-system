# D-5 Cancellation Lifecycle — Human Ratification Package

**Source baseline:** this record is derived from `docs/analysis/D-5-cancellation/README.md`
(the D-5 through D-5.10 analysis archive), specifically the boundary
established in **D-5.10 — Final Minimal Ratification Boundary Audit**. It
does not perform new analysis, does not reopen D-5.1–D-5.10, and does not
select an option. It exists solely to present the D-5.10 result in a
format a human can directly ratify against.

**Update (D-5.14):** D5-R1 has been **HUMAN-RATIFIED** as
**NOT-REVERSIBLE / PERMANENT**. D5-R2 (successor traceability) is now the
active open question. D5-R3 and D5-R4 (both reversal-specific) are now
inactive under the ratified branch and remain unratified. Nothing else in
this file has changed status. Nothing in this file authorizes any code,
schema, migration, state-machine, service, or test change.

---

## D5-R1 — Root Decision — **HUMAN-RATIFIED**

- **Decision ID:** D5-R1
- **Title:** Cancellation Reversibility (Root)
- **Status:** `RATIFIED`
- **Type:** PRINCIPLE
- **Exact human question:** Is P1 business cancellation reversible, or is
  it permanent for the original business-action identity?
- **Activation condition:** None — this was the sole unconditional D-5
  decision.
- **Options that were presented:**
  - **Option A — REVERSIBLE:** Cancellation does not permanently
    terminate the original business-action identity. A separately
    recorded reversal may restore operative validity, subject to
    whatever additional rules are subsequently ratified (see D5-R3,
    D5-R4).
  - **Option B — NOT-REVERSIBLE / PERMANENT:** Cancellation permanently
    terminates the original business-action identity. Any later
    continuation is a distinct business action (see D5-R2).
- **Current selection:** `OPTION B — NOT-REVERSIBLE / PERMANENT`
- **Ratified semantic meaning, recorded exactly:**
  - P1 cancellation is **permanent** for the original business-action
    identity.
  - The original business action **cannot become operative again** after
    P1 cancellation.
  - A later continuation of the underlying business need is represented
    as **a new, distinct business-action identity**.
  - That new business action must follow the **applicable existing
    authorization/approval lifecycle** — no shortcut or reduced
    authorization path is introduced by this ratification.
  - **Historical cancellation remains immutable historical truth** — the
    original cancellation fact is never mutated, deleted, or
    reinterpreted.
  - **No reversal fact, reversal event, or reversal mechanism is
    introduced** by this ratification. D5-R3 and D5-R4 (both
    reversal-specific) are therefore inactive under this branch — see
    their entries below.
- **Basis for ratification:** This decision was made by explicit human
  ratification. It was informed by, but is not derived from or
  equivalent to, the independent architectural recommendation in
  **D-5.13 — Cancellation Model Independent Architecture Recommendation
  Audit**, which recommended Option B. D-5.13's analysis is supporting
  architectural reasoning, not evidence of a product requirement, and is
  not itself the authority for this decision — the human ratification is.
- **Dependencies:** None.
- **Why human ratification was required:** This determines the
  authoritative business meaning of cancellation and whether the same
  original business-action identity may regain operative validity after
  cancellation. No lower-level document, implementation, or AI agent may
  decide this on its own — accordingly, none did; a human made this
  decision explicitly.
- **What this decision unlocks:** D5-R2 (successor traceability) is now
  the active conditional question. D5-R3 and D5-R4 (both
  reversal-specific) are now inactive under this ratified branch and
  remain unratified.
- **What remains deferred:** All items in the Deferred Questions section
  below remain deferred; this ratification does not resolve any of them.
- **Source baseline:** D-5.10, Section 3 ("Final Test #1 — Root
  Decision") and Section 11 ("Final Status"); D-5.13's independent
  recommendation (supporting analysis only, not the ratifying authority).

---

## D5-R2 — Successor Traceability (Now Active)

- **Decision ID:** D5-R2
- **Title:** Successor Traceability
- **Status:** `OPEN — REQUIRES HUMAN RATIFICATION` (now active, since
  D5-R1 has been ratified as NOT-REVERSIBLE / PERMANENT)
- **Type:** GENERAL ARCHITECTURE / LINEAGE POLICY
- **Exact human question:** When a new business action is created after a
  previous business action was permanently cancelled, must the new
  action explicitly link to its cancelled predecessor?
- **Activation condition:** D5-R1 = NOT-REVERSIBLE / PERMANENT —
  **satisfied**, per the ratification recorded above.
- **Options / possible answers:** Not enumerated here — this record does
  not design the linkage mechanism and does not propose yes/no. Neither
  "traceability is required because it is useful" nor "traceability is
  unnecessary because R1 is permanent" is assumed.
- **Current selection:** `NONE — AWAITING HUMAN RATIFICATION`
- **Dependencies:** D5-R1 = NOT-REVERSIBLE / PERMANENT (satisfied).
- **Why human ratification is required (once active):** Permanent
  cancellation creates the possibility of a distinct successor business
  action; whether that successor must be traceable to its predecessor
  affects audit/traceability guarantees beyond cancellation alone. This
  is not required to ratify D5-R1 itself.
- **What this decision unlocks:** Whether SourcingEvent/PO
  lineage-linkage design work is needed at all (itself deferred further,
  see below).
- **What remains deferred:** The exact linkage mechanism, and everything
  in the Deferred Questions section.
- **Source baseline:** D-5.10, Section 4-A and Section 9-B/Item 2.

---

## D5-R3 — Reversal Authority (Inactive Under Ratified Branch)

- **Decision ID:** D5-R3
- **Title:** Reversal Authority
- **Status:** `INACTIVE — D5-R1 RATIFIED AS NOT-REVERSIBLE / PERMANENT`.
  This question presupposed reversal exists; it does not, under the
  ratified branch. This is **not** a ratification of D5-R3 itself in
  either direction — it simply never activates while D5-R1 stands as
  ratified. If D5-R1 is ever revisited by a future, separate human
  ratification, D5-R3 would need to be considered again from scratch.
- **Type:** PRINCIPLE
- **Exact human question:** Does reversal constitute its own
  consequential action requiring a distinct Authority evaluation,
  separate from whatever authorized the original cancellation?
- **Activation condition:** Only if D5-R1 = REVERSIBLE.
- **Options / possible answers:** Not selected here (yes / no).
- **Current selection:** `NONE — AWAITING HUMAN RATIFICATION` (and not
  yet active pending D5-R1)
- **Dependencies:** D5-R1 = REVERSIBLE.
- **Why human ratification is required (once active):** U3 (RATIFIED)
  establishes the shared Authority concept and requires explicit mapping
  for new domain-relevant identities/actions, but U3 does not itself
  establish whether reversal must be treated as a distinct
  Authority-requiring consequential action — that determination changes
  what future implementation is obligated to build.
- **What this decision unlocks:** Whether the five-part U3 domain mapping
  (Authority / Capability / Tenant Binding / temporal semantics /
  enforcement boundary) must be performed for reversal specifically.
- **What remains deferred:** The mapping itself, and the specific
  authorization mechanism.
- **Source baseline:** D-5.10, Section 5-A and Section 7 (split from
  D-5.9's bundled "Item 3").

---

## D5-R4 — Reversal Propagation (Inactive Under Ratified Branch)

- **Decision ID:** D5-R4
- **Title:** Reversal Propagation
- **Status:** `INACTIVE — D5-R1 RATIFIED AS NOT-REVERSIBLE / PERMANENT`.
  This question presupposed reversal exists; it does not, under the
  ratified branch. This is **not** a ratification of D5-R4 itself in
  either direction — it simply never activates while D5-R1 stands as
  ratified. If D5-R1 is ever revisited by a future, separate human
  ratification, D5-R4 would need to be considered again from scratch.
- **Type:** PRINCIPLE
- **Exact human question:** Must a reversal's effect propagate through
  the same ancestor/descendant chain rules established for cancellation
  (D8), or does reversal have its own, potentially narrower, propagation
  scope?
- **Activation condition:** Only if D5-R1 = REVERSIBLE.
- **Options / possible answers:** Not selected here (symmetric with
  cancellation propagation / independent, narrower scope). Neither
  symmetry nor asymmetry is assumed.
- **Current selection:** `NONE — AWAITING HUMAN RATIFICATION` (and not
  yet active pending D5-R1)
- **Dependencies:** D5-R1 = REVERSIBLE.
- **Why human ratification is required (once active):** The existing
  cancellation propagation rule (D8, DERIVED) was established specifically
  for cancellation's downward effect; nothing in the existing analysis
  proves reversal must be symmetric with it, and the two directions have
  not been shown equivalent.
- **What this decision unlocks:** Whether parent/child reversal
  interaction scenarios (D-5.9's Q10) need their own design work.
- **What remains deferred:** The exact propagation mechanism.
- **Source baseline:** D-5.10, Section 5-B and Section 7 (split from
  D-5.9's bundled "Item 3").

---

## Decision Dependency Diagram

```text
D5-R1  — RATIFIED: NOT-REVERSIBLE / PERMANENT
│
├── NOT-REVERSIBLE  ← ratified branch, now active
│   └── D5-R2 — successor traceability (OPEN — now active)
│
└── REVERSIBLE  ← not chosen; branch inactive
    ├── D5-R3 — reversal Authority (INACTIVE — never activates on this branch)
    └── D5-R4 — reversal propagation (INACTIVE — never activates on this branch)

All other identified D-5-adjacent questions remain DEFERRED / OUTSIDE this
ratification package (see below) — D5-R1's ratification does not resolve
any of them.
```

---

## Deferred Questions — Not D-5 Ratification Blockers

None of the following is a required D-5 decision. Each is recorded here
only so it is not lost, and explicitly so it is not mistaken for part of
this ratification package:

- **DecisionPackage reuse / cardinality** — general data-model question,
  independent of D5-R1's answer.
- **SourcingEvent reuse for continuation** — lineage/domain-model
  question, additionally gated on `docs/architecture/02-domain-model.md`
  not yet being recorded.
- **PO identity reuse / ERP retransmission behavior** — ERP Adapter
  Contract / integration territory, not cancellation-lifecycle semantics.
- **Dual control for cancellation/reversal** — belongs to the separate R9
  authorization-scope track (see `docs/decisions/ratified.md` R9 and
  `docs/decisions/open.md`), not to D-5.
- **Supplier-response / quote data retention on cancellation** — evidence
  lifecycle policy, applies regardless of D5-R1's answer.
- **Changed commercial terms during reversal** — downstream
  commercial-integrity policy; relevant only if D5-R1 = REVERSIBLE, but
  not a blocker to ratifying D5-R1 itself. The coherence boundary (that
  reversal is only internally coherent with unchanged terms) is already
  a DERIVED finding, not a policy in need of ratification here.
- **Exact reversal ordering/concurrency mechanism** — implementation. The
  semantic minimum is already established (see Derived Consequences
  below) and is not reopened or redesigned here.
- **Exact U3 Authority mapping for reversal** — implementation/design
  work that occurs only if D5-R3 is ratified YES; not performed now.

---

## Derived Consequences — Not Requiring Human Ratification

These follow directly from already-ratified/derived architecture and are
recorded here as facts, not as decisions awaiting a human choice:

- **If D5-R1 = NOT-REVERSIBLE:** a continuation is necessarily a distinct
  business identity, and under M2 (Approval as historical, INSERT-only,
  referencing a frozen DecisionPackage) that distinct continuation
  requires its own new Approval. This is not a separate ratification
  question — it is a logical consequence of M2 plus the meaning of
  "permanent."
- **If D5-R1 = REVERSIBLE:** the minimum ordering property already
  established remains required — there must be a well-defined ordering
  such that operative state is computable at any point, and the send-time
  gate must evaluate the current authoritative state immediately before
  transmission initiation. The specific ordering *mechanism* is
  implementation and is not decided here.
- **Under either branch:** creation of a new Operation remains subject to
  the existing Operation-creation-gate semantics (D7, DERIVED). D7 is not
  reopened, reinterpreted, or made conditional by this record.

---

## What This Record Does Not Do

- D5-R1 has been ratified as Option B (see above); this record does not
  additionally select or imply any answer for D5-R2.
- It does not resolve D5-R3 or D5-R4 in either direction — they are
  inactive under the ratified branch, not decided.
- It does not resolve, narrow, or silently close any item in the Deferred
  Questions section.
- It does not reopen or reinterpret M2, B2, C (Authority/Capability
  separation), U3, D7, D8, F-1, or any other RATIFIED/DERIVED item.
- It does not change, renumber, or assign any SEC-ID — SEC-020, SEC-021,
  and SEC-025 remain exactly as frozen in D-5.7.2; R9 remains without an
  assigned SEC-ID.
- It does not authorize, imply, or begin any code, schema, migration,
  state-machine, service, or test change.
