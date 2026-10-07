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
| SEC-010 | Supplier authentication signal (how confidently a supplier response is attributed to the real supplier) | High | **OPEN / DESIGN GAP** — the V1 limitation is now explicitly ratified as `RFQ-ATT1` (`docs/decisions/ratified.md`: the system makes no identity/authority claim about a Supplier Response submitter, beyond `RFQ-R1`–`RFQ-R5`'s existing targeting/consumption semantics); this control itself remains OPEN for any future stronger attribution/authentication mechanism, which would require its own separate ratification |
| SEC-011 | UNKNOWN-never-inferred enforcement | High | RATIFIED (principle) |
| SEC-012 | Runtime tenant guard (enforcing tenant match at runtime, not just at query construction) | High | **RATIFIED / IMPLEMENTED / VERIFIED** — mechanism ratified as `R15` (`docs/decisions/ratified.md`); implemented as a Prisma Client Extension (`app/src/db/client.ts`) covering the service layer and the authorization hot-path (commits `5126a11`, `efacff0`), with dedicated tests (`app/test/tenantGuard.test.ts`). Not PostgreSQL Row-Level Security — RLS adoption remains its own, separate, OPEN decision |
| SEC-013 | Human authorization required for RFQ/PO/ERP writes in MVP | High | RATIFIED (principle), default-on absent separate ratification |
| SEC-014 | Prepare/transmit separation | High | RATIFIED (principle) |
| SEC-015 | Memory exclusion list (what must never enter ProcurementMemory / AI context) | Medium | **OPEN / DESIGN GAP** — exact exclusion list not specified |
| SEC-016 | Integration error sanitization | Medium | **OPEN / DESIGN GAP** |
| SEC-017 | Immutable/versioned commercial artifacts | High | RATIFIED (principle) |
| SEC-018 | AI tool entity/tenant match check | High | **OPEN / DESIGN GAP** |
| SEC-019 | Runtime tool allowlist per context | High | **OPEN / DESIGN GAP** |
| SEC-020 | Idempotency on critical operations | High | RATIFIED (principle) — idempotency explicitly not equated with correctness |
| SEC-021 | One-tenant-per-execution | High | RATIFIED (principle) |
| SEC-022 | Cancellation/invalidation enforcement (blocking execution/transmission once a business action is cancelled) | High | **OPEN** — the root D-5 cancellation-lifecycle question (`D5-R1`) is now ratified as NOT-REVERSIBLE/PERMANENT, so this control is no longer blocked on an unratified root decision; it remains OPEN as an implementation task (no enforcement design has been done against the ratified model yet), and the conditional `D5-R2` (successor traceability) question remains separately OPEN (see `docs/decisions/open.md`) |
| SEC-023 | Audit/export access authorization | Medium | RATIFIED (principle) |
| SEC-024 | Log access control (tenant-scoped, authorization-gated) | Medium | **OPEN / DESIGN GAP** |
| SEC-025 | Minimum ERP credential scope | High | RATIFIED (principle) |

## Notes

- Rows marked **OPEN / DESIGN GAP** are recorded as genuinely unresolved
  design points, not as bugs or omissions in this documentation pass. They
  must not be silently resolved by a future document without an explicit
  ratification step.
- SEC-022 is called out specifically because its completion previously
  depended on the D-5 cancellation-lifecycle root question, which is now
  ratified (`D5-R1`, NOT-REVERSIBLE/PERMANENT). SEC-022 itself remains
  OPEN — no enforcement design has been done against that ratified model
  yet, and the conditional `D5-R2` (successor traceability) question is
  separately still OPEN — but it is no longer blocked on an unratified
  root decision.
- This matrix does not assign a "target date" or "owner" — those are
  process/PM concerns outside architecture documentation scope.
