# Document 00 — Canonical Baseline

Status of this document: **RATIFIED baseline framing** (product positioning and
authority boundary) **+ DERIVED lifecycle sketch** (see explicit marking below).
Recovered from prior architecture-analysis conversation; recorded here as
canonical for the first time in this repository.

## Product

**YGT AI Procurement Automation** ("Procurement Copilot") — an ERP-integrated
corporate purchasing automation platform.

## Product positioning — RATIFIED

- Does **not** replace the existing ERP. The ERP remains the system of record
  for ERP-side transaction/posting/fulfillment state.
- Does **not** claim to fully replace procurement employees. It is a
  human-in-the-loop automation layer.
- Operates **on top of** an existing ERP, not instead of one.
- Provides procurement **workflow automation**: request intake, supplier
  research assistance, RFQ drafting/dispatch, quote extraction/comparison,
  decision support, and ERP synchronization.
- Current scope is an **MVP** built around human-in-the-loop authorization for
  consequential actions (see `01-system-principles.md`).

## Core lifecycle — DERIVED (conversation-established sketch, NOT an implementation contract)

```
Request Owner
  → Procurement Request
  → AI Analysis / Clarification
  → Validation
  → Supplier Research
  → Supplier Suitability
  → RFQ
  → Supplier Response
  → Quote Extraction / Validation / Comparison
  → Decision Package
  → Manager Approval
  → Purchase Order
  → Supplier Order Communication
  → ERP Sync
  → Tracking / Reconciliation
```

**This lifecycle sketch is DERIVED, not RATIFIED, and is explicitly not an
implementation contract.** It reflects the shape of the domain as established
across prior conversation-based architecture analysis (Documents 00–02 in that
analysis chain), but no canonical state machine has been ratified into this
repository yet. A future state-machine ratification (`05-lifecycle-and-state-machines.md`)
is the authoritative source once it exists — until then, this sketch is a
navigational aid only, not a source of truth for entity states or transitions.

## Authority boundary — RATIFIED

Three domains hold authority over disjoint kinds of state. None of them is
authoritative for another's domain:

- **Procurement Core** — authoritative for **business/commercial state**:
  requests, RFQs, quotes, decision packages, approvals, purchase orders (at
  the commercial-decision level).
- **ERP** — authoritative for **ERP transaction/posting/fulfillment state**:
  once a purchase order (or equivalent) is transmitted, the ERP (and the
  external supplier/financial systems behind it) is authoritative for what
  actually happened to that transaction.
- **AI** — **not a system of record for anything.** AI components (LLMs,
  extraction pipelines, agents) never hold authoritative state; their output
  is always subject to validation and human/business-rule gating before it
  can affect authoritative state in either Procurement Core or the ERP. See
  `01-system-principles.md` items 1–6.

## Document map

| Document | Covers | Status of content |
|---|---|---|
| `01-system-principles.md` | Constitutional principles | RATIFIED |
| `02-domain-model.md` | Domain entities | Recorded — mixed, per-section status; see the document itself (§22 for the status-label legend) |
| `03-data-model.md` | Data model / schema baseline | RATIFIED architecture baseline (not implementation schema) |
| `04-security-model.md` | Security principles | RATIFIED baseline, several enforcement points OPEN |
| `05-lifecycle-and-state-machines.md` | Canonical state machines | NOT YET RECORDED |
| `06-integration-model.md` | ERP/external integration | NOT YET RECORDED |
| `07-ai-and-agent-model.md` | AI/agent architecture | NOT YET RECORDED |
| `08-memory-and-evidence.md` | Evidence pipeline, ProcurementMemory | Partially recorded — see `decisions/ratified.md` R8, R11, R12 |
| `09-operations-and-idempotency.md` | Idempotency, reconciliation | NOT YET RECORDED |
| `docs/decisions/ratified.md` | Ratified decision register | RATIFIED |
| `docs/decisions/derived.md` | Derived decision register | DERIVED |
| `docs/decisions/open.md` | Open decision register | OPEN (by definition) |
| `docs/security/enforcement-matrix.md` | Security control matrix | Mixed — see matrix itself |
| `docs/analysis/D-5-cancellation/` | Cancellation-lifecycle analysis archive | Analytical record, D-5 itself remains OPEN |

**Note on `05-lifecycle-and-state-machines.md`,
`06-integration-model.md`, `07-ai-and-agent-model.md`,
`09-operations-and-idempotency.md`:** this bootstrap pass recorded the
documents explicitly requested by the D-5.7 task (00, 01, 03, 04, plus the
decision registers, security matrix, and D-5 archive). These four
documents were not populated in that pass — creating them with
fabricated content would violate the "do not invent missing content"
rule — and remain **NOT YET RECORDED** rather than created empty or with
placeholder content, so that their absence is visible rather than
disguised as a thin stub. (`02-domain-model.md` was likewise unpopulated
at that time, but has since been recorded in a later pass — see the
document map above.)
