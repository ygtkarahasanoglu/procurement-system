# Implementation Playbook — Fast Track Development Protocol

Status of this document: **process/governance, not a semantic ratification.**
It changes how work is sequenced and reviewed; it does not create, close, or
reinterpret any entry in `docs/decisions/ratified.md` or
`docs/decisions/open.md`. Those registers remain the sole source of truth for
domain/architecture semantics.

## Why this exists

The project must move faster without reducing architectural, security, or
domain quality. The core rule:

> If there is no semantic/domain/architecture risk, move fast. If there is
> semantic risk, stop and reason deeply.

## The three tracks

### GREEN — Fast Track

Changes that stay completely inside already-ratified architecture and
existing semantics. Examples: ordinary CRUD completion, Product/Supplier
update, catalog/list UI, frontend wiring to existing backend capabilities,
validation improvements that preserve existing semantics, test coverage,
accessibility/UI improvements, bug fixes, small observability/operational
improvements that do not alter security semantics.

Process: `Implementation → Tests → Lightweight self-review → Commit`

No separate architecture assessment is required unless uncertainty appears.
Do NOT skip: tenant isolation, authorization, validation, regression tests,
diff inspection.

### YELLOW — Controlled Review

Medium-risk work where the architecture is already mostly established but
there is meaningful integration or security risk. Examples: RFQ email
dispatch, supplier response ingestion, PDF/Excel extraction, background jobs,
audit events, AI Gateway implementation, new workflow integration, external
service integration, significant API behavior changes.

Process: `Independent assessment → Implementation → Adversarial review → Commit`

Do not create a new semantic ratification unless the implementation reveals
a genuinely unresolved domain decision.

### RED — Architecture / Semantic Decision

Work that changes or creates domain semantics, authorization boundaries,
identity semantics, state machines, cross-tenant security model, ERP
authority, AI authority, or other foundational architecture. Examples:
Execution Authority, ERP machine identity semantics, PO
cancellation/reversal semantics, new approval semantics, AI authority to
execute actions, tenant isolation architecture changes, new canonical
identity semantics, major ERP write semantics, any work that would close or
reinterpret an OPEN decision.

Process: `Independent read-only assessment → ChatGPT semantic analysis → explicit decision → documentation-only ratification → implementation → adversarial review → commit`

Never silently close an OPEN decision.

## Risk classification rule

Before starting implementation, classify the work:

- GREEN if it clearly stays inside existing ratified semantics.
- YELLOW if implementation risk exists but semantics are already defined.
- RED if a new semantic/architectural decision is required.

If classification is uncertain, treat it as YELLOW initially and perform an
independent assessment. If the assessment discovers an actual unresolved
domain decision, escalate to RED. Do not artificially escalate trivial work.

## Batching GREEN work

When several closely related GREEN tasks form one coherent capability,
prefer a single implementation batch rather than many tiny cycles — e.g. a
"Catalog Management Batch" covering Product/Supplier create+update and
catalog visibility, with one set of focused tests, one review, one commit,
instead of three separate review/commit cycles.

A batch must be split immediately if one item introduces a new semantic
decision. Do not use batching to hide architectural risk.

## Golden-path implementation pattern

For ordinary tenant-scoped features, use the repository's existing patterns
rather than inventing new abstractions:

1. authenticated Principal
2. trusted Principal-derived tenant context
3. `tenantScoped(tenantId)`
4. domain/service validation
5. controlled mutation
6. focused happy-path test
7. adversarial cross-tenant/security test where applicable
8. E2E test when user-facing behavior materially warrants it
9. TypeScript/build checks
10. Vitest
11. Playwright where applicable
12. `git diff --check`
13. inspect exact changed files
14. commit

Do not create generic CRUD/repository/authorization frameworks merely to
make individual features look cleaner.

## Quality gates that never become optional

Regardless of GREEN/YELLOW/RED track, always preserve:

**Security** — tenant isolation, Principal-derived identity, authorization
boundaries, fail-closed behavior, no cross-tenant access.

**Domain integrity** — ratified semantics, UNKNOWN rather than inference,
DecisionPackage/Approval/PO semantics, existing state invariants.

**Testing** — focused tests for changed behavior, adversarial tests for
security-sensitive changes, regression suite, E2E for meaningful
user-facing flows.

**Git hygiene** — no unrelated changes, no accidental generated artifacts,
no migration changes unless actually required, exact commit scope, HEAD
must equal origin/main after push.

## External reference policy

GitHub projects and public examples may be used as pattern references, not
as authoritative architecture — e.g. multi-agent procure-to-pay samples,
RFQ/email/PDF workflow examples, machine-readable RFQ concepts. Inspect them
for workflow decomposition, agent boundaries, supplier communication, quote
extraction, ERP adapters, background jobs, observability, and testing
patterns. Do not copy external architecture blindly — this repository's
ratified Procurement Core remains authoritative.

## AI implementation principle

When real AI automation is implemented, preserve this chain:

```
LLM/Agent
  → AI Gateway
  → structured output
  → schema validation
  → business rules
  → authorization
  → controlled Procurement Core service
  → DB / integration
```

AI must not become the system of record. AI must not directly write to the
database or ERP.

## Role separation

- **Human Product Owner** — defines business priority, accepts/rejects
  major direction.
- **ChatGPT** — acts as architecture/domain/security gate: semantic
  analysis, decision discipline, scope control, ratification discipline,
  review of Claude assessments.
- **Claude** — acts as repository investigator, implementation engine,
  test author, and adversarial reviewer when requested. Claude does not
  independently close OPEN domain decisions.

## Decision preservation

- OPEN decisions stay OPEN unless explicitly ratified.
- Ratified decisions are not silently reinterpreted.
- AUTHN-5 remains frozen except when a real future requirement triggers one
  of its remaining OPEN questions.
- Do not reopen completed security architecture without concrete evidence.
- Do not create architecture for hypothetical future requirements unless
  necessary for the current implementation.

## Development objective

The objective is not to maximize the number of commits. The objective is to
maximize validated product capability delivered per development cycle.
Prefer coherent vertical capabilities over cosmetic incrementalism.

When the core is sufficiently usable, prioritize the real product
differentiator, in this order:

```
Procurement Core
  → Supplier Automation
  → AI Gateway / Agent
  → RFQ
  → Supplier Response / Evidence Extraction
  → Quote Intelligence
  → Approval
  → PO
  → ERP
```

Do not spend disproportionate time polishing low-value UI while the
automation engine remains absent.
