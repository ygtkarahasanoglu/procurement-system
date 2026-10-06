# Security Enforcement Matrix

Status: mixed per-row — see `Status` column. This matrix records the
security controls established in prior architecture analysis (Document 05 in
that analysis chain). It is recorded here for the first time as canonical.
**No control listed here should be read as implementation-complete** — this
repository contains no implementation. Status values reflect the
architectural/design maturity of each control, not code coverage.

| ID | Control | Severity / Importance | Status |
|---|---|---|---|
| SEC-001 | AI output never treated as authoritative without validation | High | RATIFIED (principle) |
| SEC-002 | AI-facing components have zero DB credential | High | RATIFIED (principle) |
| SEC-003 | Fetch boundary (controlling what data AI-facing components can retrieve) | High | **OPEN / DESIGN GAP** |
| SEC-004 | Schema validation required on all AI output | High | RATIFIED (principle) |
| SEC-005 | PO send-time canonical comparison (re-validating PO content against canonical state immediately before transmission) | High | **OPEN / DESIGN GAP** — mechanism not yet specified, though the *requirement* that a send-time check exist is RATIFIED |
| SEC-006 | Cache key enforcement (tenant-safe cache keying) | Medium | **OPEN / DESIGN GAP** |
| SEC-007 | Webhook gate (inbound webhook authenticity/authorization) | High | **OPEN / DESIGN GAP** |
| SEC-008 | Parser isolation (untrusted document/content parsing isolated from core systems) | High | **OPEN / DESIGN GAP** |
| SEC-009 | Supplier content treated as untrusted input | High | RATIFIED (principle) |
| SEC-010 | Supplier authentication signal (how confidently a supplier response is attributed to the real supplier) | High | **OPEN / DESIGN GAP** |
| SEC-011 | UNKNOWN-never-inferred enforcement | High | RATIFIED (principle) |
| SEC-012 | Runtime tenant guard (enforcing tenant match at runtime, not just at query construction) | High | **OPEN / DESIGN GAP** — mechanism now RATIFIED (`R15`, `docs/decisions/ratified.md`); implementation not yet built |
| SEC-013 | Human authorization required for RFQ/PO/ERP writes in MVP | High | RATIFIED (principle), default-on absent separate ratification |
| SEC-014 | Prepare/transmit separation | High | RATIFIED (principle) |
| SEC-015 | Memory exclusion list (what must never enter ProcurementMemory / AI context) | Medium | **OPEN / DESIGN GAP** — exact exclusion list not specified |
| SEC-016 | Integration error sanitization | Medium | **OPEN / DESIGN GAP** |
| SEC-017 | Immutable/versioned commercial artifacts | High | RATIFIED (principle) |
| SEC-018 | AI tool entity/tenant match check | High | **OPEN / DESIGN GAP** |
| SEC-019 | Runtime tool allowlist per context | High | **OPEN / DESIGN GAP** |
| SEC-020 | Idempotency on critical operations | High | RATIFIED (principle) — idempotency explicitly not equated with correctness |
| SEC-021 | One-tenant-per-execution | High | RATIFIED (principle) |
| SEC-022 | Cancellation/invalidation enforcement (blocking execution/transmission once a business action is cancelled) | High | **OPEN** — this control was previously identified as presupposing the D-5 cancellation-lifecycle decision as its missing prerequisite; it cannot be marked implementation-ready until D-5 is ratified (see `docs/analysis/D-5-cancellation/README.md`) |
| SEC-023 | Audit/export access authorization | Medium | RATIFIED (principle) |
| SEC-024 | Log access control (tenant-scoped, authorization-gated) | Medium | **OPEN / DESIGN GAP** |
| SEC-025 | Minimum ERP credential scope | High | RATIFIED (principle) |

## Notes

- Rows marked **OPEN / DESIGN GAP** are recorded as genuinely unresolved
  design points, not as bugs or omissions in this documentation pass. They
  must not be silently resolved by a future document without an explicit
  ratification step.
- SEC-022 is called out specifically because it is the clearest example of a
  security control whose completion is *blocked on* an unrelated but
  connected open architecture decision (D-5, cancellation lifecycle
  reversibility) — implementing SEC-022 before D-5 is ratified would risk
  encoding an unratified cancellation model into a security control.
- This matrix does not assign a "target date" or "owner" — those are
  process/PM concerns outside architecture documentation scope.
