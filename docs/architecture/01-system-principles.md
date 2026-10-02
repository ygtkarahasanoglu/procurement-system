# Document 01 — System Principles

Status: **RATIFIED.** These are the constitutional principles for the YGT
Procurement System, recovered verbatim in substance from prior
architecture-analysis conversation and recorded here canonically for the
first time. They are not reinterpreted or expanded in this recording pass.

1. AI is not system of record.
2. Procurement Core is the sole authoritative business state.
3. LLMs have no unrestricted DB access.
4. AI-facing components have zero direct DB access.
5. LLM output is schema-validated.
6. Business rules execute after AI validation, not instead of it.
7. Authorization precedes consequential mutation.
8. Only controlled services mutate authoritative state.
9. LLMs never directly write to the ERP.
10. Strict tenant isolation.
11. External supplier content is untrusted.
12. Commercial facts are evidence-first.
13. Missing information is UNKNOWN — never silently inferred or defaulted.
14. Critical commercial actions require human authorization in the MVP.
15. Prepare and transmit are separate operations.
16. The ERP is accessed only behind an adapter boundary.
17. Procurement Core is authoritative for commercial facts.
18. Important commercial records are versioned / append-only.
19. Critical operations are idempotent.
20. The AI provider is replaceable.
21. AI context access follows least privilege.
22. Consequential actions are auditable.
23. Customer data is not cross-tenant learning material by default.
24. Confidence never substitutes for evidence.
25. Entity state changes only through canonical transitions.
26. One tenant context per execution.
27. Security-control weakening is controlled and audited.
28. Cost efficiency is constitutional.
29. Agents are logical capabilities, not necessarily one LLM call per agent.

These principles are foundational constraints on every other document in this
repository. Any future document, decision, or design that would violate one
of them requires an explicit, separately ratified exception — it cannot be
overridden by silent implementation choice.
