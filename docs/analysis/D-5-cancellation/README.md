# D-5 — Cancellation Lifecycle Analysis Archive

**Current decision status: `D5-R1 RATIFIED (D-5.14) — NOT-REVERSIBLE /
PERMANENT.`** See `docs/decisions/ratified.md` (D5-R1) and
`docs/decisions/open.md` for the authoritative decision record. This
document remains a pointer/index into the analytical history that led to
that ratification — it is analysis and history, not the decision record
itself, and no implementation detail beyond what was already analyzed is
introduced here.

**Summary of the ratified outcome:** P1 business cancellation is
permanent for the original business-action identity. Reversal of the
original business action is **not** part of the ratified model. Any later
continuation of the underlying business need is represented as a new,
distinct business-action identity, following the applicable existing
authorization/approval lifecycle. **D5-R2 (successor traceability)** is
now the active open follow-on question. **D5-R3 (reversal Authority)** and
**D5-R4 (reversal propagation)** are inactive under the ratified branch —
neither was ratified in either direction; they simply do not apply once
reversal is not part of the model.

## Analysis history

### D-5 (first pass)
Established the P1 (business/decision cancellation) vs. P2
(execution/operation cancellation) distinction. Rejected "Option A —
Approval Mutation" as directly conflicting with the ratified INSERT-only
Approval baseline (M2/F-1-adjacent). Found "Option C — Operation-State
Control" alone insufficient (cannot block a fresh Operation for an
already-cancelled business action). Found "Option B — Separate Invalidation
Fact" viable at several possible scopes (PO / RFQDispatch / SourcingEvent —
not DecisionPackage, identified as a category error). Identified that
`SEC-022` (see `docs/security/enforcement-matrix.md`) presupposes D-5's
outcome as its missing prerequisite.

### D-5.1 — Business Cancellation Scope Analysis
Determined there is no existing canonical "BusinessAction" object; found
that only `RFQDispatch` and `PurchaseOrder` are the real, independent-lineage
cancellation targets. Found RFQ requires dispatch-level granularity for
partial cancellation (SourcingEvent/RFQApprovalRecord-level is too coarse).
Confirmed RFQ and PO lineages need not be forced into symmetric cancellation
semantics.

### D-5.2 — P1/P2 Propagation Analysis
Formalized that P1 dominates P2 in one direction only (not symmetric).
Proved the Operation-creation gate is logically necessary and distinct from
the send-time gate. Established that P1 propagation must hold across the
full ancestor chain, not only the immediate parent. Showed "Propagation
Guarantee" and "Chain-Walking Evaluation" are two implementation strategies
for one semantic rule, not competing semantics. Produced the D1–D11 findings
now recorded as the P1/P2 relationship set in `docs/decisions/derived.md`.

### D-5.3 — Reversal / Re-Approval / New Business Action Analysis
Analyzed, without selecting, three candidate semantic interpretations for
what it means for a P1-cancelled business artifact to become executable
again: **A. Cancellation Reversal**, **B. New Approval**, **C. New Business
Action**. Found these are not mutually exclusive points on one spectrum —
they answer different questions (is the original decision still operative?
does execution need a fresh authorization act? is the result the same
commercial/audit identity?). Surfaced several genuinely new open questions
(DecisionPackage reuse, cross-artifact traceability linkage, upward
propagation of reversal). No selection was made among A/B/C.

### D-5.4 — Cancellation Lifecycle Semantics
Tested whether "a cancellation occurred" (historical fact) and "cancellation
currently prohibits execution" (operative effect) must always coincide.
Found this divergence is **semantically coherent** (by analogy to how
Approval's historical truth is already separated from its "currently
applicable" evaluation at Operation-creation/send time) but **not
necessary** — a system can function correctly with the two permanently
identical. Defined three lifecycle models (A. Permanent Cancellation, B.
Reversible Cancellation, C. Terminal + Continuation) and stress-tested all
three against ten scenarios and a falsification pass. No model was selected;
several genuinely new open questions were surfaced (reversal's own Authority
mapping under U3, cancel/reverse event ordering and race-safety, downward
propagation of a *reversal* as opposed to a cancellation).

### D-5.5 — Reversibility Necessity & Requirement Traceability Audit
Asked a different question: does any *existing product requirement* —
as opposed to architectural possibility — actually require same-identity
reversal? Audited the available evidence (the conversation-established
record, since no procurement-system repository was accessible at that
point) and found: **"No existing requirement was found that necessarily
requires reversible cancellation of the same business artifact/lineage."**
This was explicitly not extended to "therefore reversibility should never
exist" — that would be a product judgment beyond the evidence. Several
apparent reversal scenarios (PO transmission failure, ERP sync failure) were
found, on inspection, to be ordinary retry/reconciliation/compensating-action
problems already covered by the existing P1/P2/F-1 baseline, not genuine
reversibility questions at all.

### D-5.6 — Canonical Evidence Recovery Audit
Verified that the `procurement-system` repository (this repository) exists
and is accessible, but at the time of that audit was **completely empty** —
no commits, branches, or tags. Concluded that D-5.5's finding could not be
independently confirmed or refuted against canonical repository evidence,
because no such evidence existed at that time. Explicitly classified:
`D-5.5 = DERIVED / EVIDENCE-LIMITED`, not RATIFIED — the conversation-derived
finding stands on its own original basis, but was not, as of D-5.6,
corroborated by any repository artifact.

## Status of D-5.5 in this repository

Per the D-5.6 finding, and re-affirmed here: **D-5.5 remains a
conversation-derived analytical finding** — no requirement was identified in
the available prior analysis that necessarily requires reversible
cancellation of the same business artifact/lineage. **This finding has not
been independently verified against canonical repository documents**,
because the canonical procurement-system repository was empty during D-5.6.
This bootstrap pass (D-5.7) does not change that — populating this
repository with architecture documentation is not the same as discovering a
pre-existing product requirement, and this archive does not treat it as
such.

**Classification: `D-5.5 = DERIVED / EVIDENCE-LIMITED`, not `RATIFIED`.**

### D-5.7–D-5.10 — Boundary Minimalization
Narrowed the three-way A/B/C framing into a strict dependency structure:
the root question was reframed as the binary **D5-R1** (reversible vs.
not-reversible), with "Model C" shown to be a downstream lineage-policy
consequence of "not-reversible" rather than an independent root option
(D-5.9 §8). Produced the minimal conditional decision set — **D5-R2**
(successor traceability, active only if not-reversible), **D5-R3**
(reversal Authority, active only if reversible), **D5-R4** (reversal
propagation, active only if reversible) — and moved DecisionPackage
reuse, SourcingEvent reuse, PO/ERP behavior, R9/dual-control, and
changed-commercial-terms policy out of D-5's core scope as deferred,
non-blocking, or cross-domain questions.

### D-5.11 — Ratification Record Preparation
Converted the D-5.10 boundary into the human-ratification-ready package
at `docs/decisions/D-5-ratification-package.md` (D5-R1 through D5-R4),
without selecting an option.

### D-5.12 — R1 Scenario Semantics Audit
Stress-tested sixteen realistic procurement scenarios against Option A
and Option B. Found several superficially reversal-like scenarios
(temporary budget freeze, supplier/stock temporary unavailability) were
better classified as suspension/execution-condition questions, not
cancellation questions at all. Found no scenario logically compelled
either option (R1 Blocking Test: NO). No option selected.

### D-5.13 — Independent Architecture Recommendation
Produced an independent architectural recommendation (not a ratification)
for Option B — NOT-REVERSIBLE / PERMANENT — reasoning from the system's
own constitutional values (evidence-first correctness, low ambiguity,
auditability, cost efficiency) rather than from external requirements,
since D-5.5/D-5.12 established neither option was externally mandated.
Identified no architectural contradiction with the ratified baseline for
either option.

### D-5.14 — Human Ratification
**D5-R1 was explicitly human-ratified as NOT-REVERSIBLE / PERMANENT**,
informed by but not derived from D-5.13's recommendation. See
`docs/decisions/ratified.md` (D5-R1) for the full decision record.

## Ratification package

The analysis was distilled into a human-ratification-ready package at
`docs/decisions/D-5-ratification-package.md` (items D5-R1 through D5-R4).
D5-R1 in that package is now marked RATIFIED; D5-R2 is OPEN; D5-R3 and
D5-R4 are INACTIVE under the ratified branch.

## What remains open

- **D5-R2 — Successor Traceability** (the only active D-5-family open
  question — see `docs/decisions/open.md` and
  `docs/decisions/D-5-ratification-package.md`).
- DecisionPackage reuse on continuation (surfaced in D-5.3) — deferred,
  general data-model question, unaffected by D5-R1's ratification.
- Whether transient operational failures (supplier/ERP/integration
  temporarily unavailable) should ever have been modeled as P1
  cancellation at all, versus purely as execution-layer/Capability
  failures (surfaced in D-5.5 Scenario C; reconfirmed in D-5.12's
  Temporary-Suspension Test) — still an open, unresolved question,
  independent of D5-R1's ratification.

**No longer open, as a direct consequence of D5-R1's ratification:**
D5-R3 (reversal Authority) and D5-R4 (reversal propagation) — both
presupposed reversal, which is not part of the ratified model. This is
not a ratification of D5-R3/D5-R4 themselves; they simply do not apply.
Cross-artifact traceability/linkage for a "new business action"
continuation is no longer a *conditional* question (it was previously
described as relevant "if Model C is ever adopted") — it is now the
directly active **D5-R2**, since the ratified model always produces a new
business-action identity on continuation.

This document is a pointer and summary; the full reasoning for each
conclusion lives in the original analysis passes (not separately
reproduced here to avoid duplicating, and risking silent drift from, the
original reasoning).
