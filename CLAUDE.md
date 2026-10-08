# YGT Procurement System

AI procurement copilot. Flow: Request -> SourcingEvent -> RFQ (email) -> Supplier Quote -> Recommendation -> Human Decision -> Frozen DecisionPackage -> Approval -> PurchaseOrder.

## Layout
- `app/` Express + Prisma + PostgreSQL 16 backend (TypeScript). Services in `src/services/`, HTTP in `src/api/server.ts`, rules in `src/domain/`.
- `web/` React 19 + Vite frontend. API calls only via `src/api/client.ts`.
- `docs/` architecture + decision registers. Do NOT read whole files (see below).

## Commands (run inside `app/`)
- Typecheck: `npm run build`
- Tests: `npm test` (needs `app/.env.test` with DATABASE_URL; real Postgres, not mocked)
- Single test: `npx dotenv -e .env.test -- vitest run test/<file>.test.ts`
- New migration: `npm run db:migrate -- --name <name>`; then `npm run db:generate`
- API: `npm run dev:api` (:3000). Web: `cd ../web && npm run dev` (:5173)

## Hard rules
- Every DB access to a tenant-scoped model goes through `tenantScoped(tenantId)` from `src/db/client.ts`. Known, deliberate exceptions (see that file's own comment): `Tenant`/`Session`/`ExternalIdentity` (no `tenantId` column), `RFQProviderDeliveryEvent` (nullable `tenantId`), and the RFQ-R1 supplier-response token lookup (tenant not known yet). Outside those, never use raw `prisma` for tenant data.
- Every service function takes `tenantId` and validates ids with `src/domain/validation.ts`.
- Approval is INSERT-only; QuoteVersion is immutable; DecisionPackage is frozen before Approval.
- Cross-currency price comparison only via FX-1 (TCMB, TRY, one bulletin per comparison). Never compare raw prices across currencies.
- Recommendation is deterministic, not AI. Do not present it as AI.
- Never close an OPEN decision silently. If a task needs one, stop and ask me.
- Run `npm run build` and the relevant tests before every commit.

## Decision registers: how to read them cheaply
- `docs/decisions/ratified.md` is ~4300 lines. Never read it whole. Find the ID you need:
  `grep -n "^### RFQ-EH7" docs/decisions/ratified.md` then read only that section.
- `docs/decisions/open.md` lists what is still undecided.
- Risk tracks (GREEN / YELLOW / RED): `docs/development/implementation-playbook.md`.
  GREEN work (CRUD, UI, tests, bug fixes): just implement, test, commit. No docs update needed.

## Working style
- Smallest change that fully works. No new dependency for a few lines.
- Keep commit messages short. Do not add long explanatory comments citing decision IDs unless the code would be wrong without it.
- Reply to me in Turkish, short.
