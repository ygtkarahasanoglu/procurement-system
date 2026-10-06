# YGT Procurement System — Canonical Architecture Repository

This repository is the **canonical architecture source-of-truth** for the YGT AI
Procurement Automation ("Procurement Copilot") system.

## Current status

This repository contains both the **canonical architecture/decision
documentation** (`docs/`, recovered from prior architecture analysis
conversations and recorded here so it survives independently of any single
conversation transcript) and a **real, running implementation** of one
bounded vertical slice: `app/` is an Express/Prisma/PostgreSQL backend with
OpenID Connect (OIDC + PKCE) authentication and server-side sessions; `web/`
is a React frontend wired to that authenticated backend. Automated tests
exist and pass against a real PostgreSQL instance and a real browser. See
`app/README.md` for exactly what this implementation does and does not
cover — in particular, it has no AI/LLM integration, no ERP integration, no
supplier communication, and no deployment infrastructure (CI/CD, containers,
hosting) yet.

## How decisions are classified

Every architectural statement in this repository is tagged with exactly one of
four statuses. The tag is load-bearing — it tells a reader (human or AI) what
they are allowed to build on:

- **RATIFIED** — explicitly approved by a human decision-maker. Safe to treat
  as settled, until a human explicitly reopens it.
- **DERIVED** — follows logically from RATIFIED decisions, but has not itself
  been separately put to a human for approval. Treat as a strong working
  assumption, not as license to skip ratification when a decision is
  consequential.
- **OPEN** — a real architectural question that has not been decided. Must
  not be silently resolved by an implementer, a future analysis pass, or an
  AI agent. Needs an explicit human ratification step before it can move to
  RATIFIED.
- **NOT ANALYZED** — outside the scope of the analysis that touched the
  surrounding text. Absence of coverage, not absence of a requirement.

## Principle: no silent architecture decisions

No document in this repository should ever present an OPEN question as if it
were settled, or quietly narrow an OPEN question's options, or upgrade a
DERIVED conclusion to RATIFIED without a real human ratification event. Where
information is genuinely missing, documents say `OPEN — NOT SPECIFIED` or
`EVIDENCE GAP` rather than inventing plausible-sounding content.

## Where to start

1. `docs/architecture/00-canonical-baseline.md` — product framing, core
   lifecycle, authority boundaries, and a map of the other documents.
2. `docs/architecture/01-system-principles.md` — the ratified constitutional
   principles governing the whole system.
3. `docs/decisions/ratified.md`, `docs/decisions/derived.md`,
   `docs/decisions/open.md` — the decision registers.
4. `docs/security/enforcement-matrix.md` — the security control matrix.
5. `docs/analysis/D-5-cancellation/README.md` — the cancellation-lifecycle
   analysis archive (D-5 through D-5.6), the most actively contested open
   decision area at the time of this bootstrap.
6. `app/README.md` — the implementation reference: what is actually built
   in `app/`/`web/`, and exactly what is not.
