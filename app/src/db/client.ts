import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the process. For V1 this is
// sufficient; connection pooling tuning is explicitly out of scope.
//
// Still exported and used, unchanged, by every non-service consumer
// that already imported it before SEC-012/R15 (AUTHN's own modules —
// session.ts, sessionAuthenticator.ts, externalIdentity.ts,
// domain/authorization.ts — plus seed.ts and the pilot provisioning
// script). None of those is a Procurement Core service and none is
// touched by this decision.
export const prisma = new PrismaClient();

// ---------------------------------------------------------------------
// SEC-012 / R15 (docs/decisions/ratified.md) — runtime tenant guard.
//
// Defense-in-depth backstop BEHIND the existing, still-primary
// service-layer tenant enforcement (every Procurement Core service
// function already requires and applies an explicit tenantId — this
// does not change). The authoritative tenant context is carried
// explicitly, by the caller, into a tenant-bound Prisma Client
// Extension — never via AsyncLocalStorage or any other implicit
// request/execution context, and never derived from HTTP req here. Any
// caller (an HTTP route via a service function, a future background
// worker, a future ERP machine identity caller) supplies tenantId
// explicitly, exactly as every service function signature already
// requires today.
//
// The guard performs its enforcement deterministically against each
// operation's own arguments or (for unique-lookup reads) its own
// already-necessary result — it never issues an additional Prisma/
// database query of its own.
// ---------------------------------------------------------------------

/**
 * Models carrying a direct `tenantId` column in the current schema
 * (app/prisma/schema.prisma) — verified by reading the schema, not
 * assumed. `Tenant`, `ExternalIdentity`, and `Session` are deliberately
 * excluded: none of the three has a tenantId column (Tenant is the
 * root; ExternalIdentity/Session are scoped via userId only, per
 * AUTHN-2/AUTHN-4's own, separate, unchanged design). This is a plain,
 * manually-maintained allowlist, not runtime schema introspection, by
 * deliberate R15 scope choice.
 */
const TENANT_SCOPED_MODELS = new Set([
  "User",
  "Product",
  "Supplier",
  "ProcurementRequest",
  "RequestLine",
  "SourcingEvent",
  "SupplierQuote",
  "QuoteVersion",
  "RecommendationRecord",
  "DecisionPackage",
  "Approval",
  "PurchaseOrder",
]);

/** Thrown when a caller fails to supply a tenant context to `tenantScoped()` at all. */
export class TenantContextMissingError extends Error {
  constructor() {
    super("tenantScoped() requires a non-empty tenantId.");
    this.name = "TenantContextMissingError";
  }
}

/**
 * Thrown by the runtime guard itself — never by ordinary, correctly
 * tenant-scoped service code — when a tenant-scoped Prisma operation
 * would otherwise run without the required tenant scope, or with a
 * scope that does not match the authoritative tenant context. This is
 * the SEC-012 backstop firing: evidence of a bug in the primary
 * service-layer enforcement, not a normal business-logic outcome, and
 * deliberately distinct from the existing `domain/errors.ts`
 * `TenantMismatchError` (that one is a normal, expected 404-mapped
 * outcome for a caller-claimed tenant mismatch; this one is the
 * defense-in-depth backstop catching what should already have been
 * prevented).
 */
export class TenantGuardRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantGuardRejection";
  }
}

function readTenantId(value: unknown): string | undefined {
  if (value && typeof value === "object" && "tenantId" in value) {
    const t = (value as { tenantId?: unknown }).tenantId;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/**
 * Nested relation writes (e.g. `procurementRequest.create({ data: { ...,
 * lines: { create: [...] } } })`) are invisible to `$allOperations` — empirically
 * verified: a probe extension recorded exactly one call (the parent
 * `ProcurementRequest.create`) for such a write, with no separate call for
 * the nested `RequestLine` row. The top-level `create`/`createMany` checks
 * above therefore cannot see a nested row's own `tenantId` at all. This
 * walks `data` for any nested `{ create: <row> | <row[]> }` relation-write
 * shape and validates each nested row's own `tenantId` the same way the
 * top-level row is validated — required and matching, fail-closed — so a
 * mismatched or missing nested tenantId is rejected before the single
 * parent query runs. No extra query is issued; this only inspects the
 * already-supplied `args`. Recurses one level further to stay defensive
 * against doubly-nested writes, though no current service code nests more
 * than once.
 */
function validateNestedCreates(data: unknown, tenantId: string, model: string): void {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return;
  }
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const relationWrite = value as Record<string, unknown>;
    if (!("create" in relationWrite)) {
      continue;
    }
    const createValue = relationWrite.create;
    const rows = Array.isArray(createValue) ? createValue : [createValue];
    for (const row of rows) {
      const rowTenantId = readTenantId(row);
      if (rowTenantId === undefined) {
        throw new TenantGuardRejection(`${model}.create's nested "${key}.create" row is missing tenantId.`);
      }
      if (rowTenantId !== tenantId) {
        throw new TenantGuardRejection(
          `${model}.create's nested "${key}.create" row's tenantId does not match the authoritative tenant context.`
        );
      }
      validateNestedCreates(row, tenantId, model);
    }
  }
}

// Operations whose `where` accepts arbitrary (non-unique) fields —
// tenantId is validated directly against the already-supplied `args`,
// before the query runs, with no extra query of the guard's own.
const PRE_CHECK_WHERE_OPERATIONS = new Set([
  "findFirst",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

// Unique-lookup mutation operations. Per the current schema, none of
// the 12 tenant-scoped models declares a tenantId-inclusive unique
// constraint (verified by reading app/prisma/schema.prisma), so
// `tenantId` cannot be added to a unique `where` here. Validating these
// safely would require an additional lookup query, which R15 forbids.
// No current service code calls any of these on a tenant-scoped model;
// the guard rejects them outright rather than allowing an unenforceable
// mutation through — the existing, already-used `updateMany`/
// `deleteMany` (with an explicit tenantId filter) remain the supported
// path for a single-row mutation.
const REJECT_UNIQUE_MUTATION_OPERATIONS = new Set(["update", "delete", "upsert"]);

// Unique-lookup READ operations — validated by inspecting the fetched
// RESULT's own tenantId after the one, already-necessary query runs,
// rather than by mutating `where` (which the unique-constraint shape
// does not permit). Adds no additional query.
const POST_CHECK_RESULT_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow"]);

/**
 * Returns a tenant-bound Prisma client: every tenant-scoped-model
 * operation performed through it is validated, deterministically and
 * without any extra query, against the given authoritative `tenantId`.
 * Models outside `TENANT_SCOPED_MODELS` (Tenant, ExternalIdentity,
 * Session) pass through untouched. Call this with the Principal's own
 * tenantId — the same value every service function already receives as
 * an explicit parameter today; this function does not change that.
 */
export function tenantScoped(tenantId: string) {
  if (!tenantId) {
    throw new TenantContextMissingError();
  }

  return prisma.$extends({
    name: "sec-012-tenant-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          if (operation === "create") {
            const rowTenantId = readTenantId((args as { data?: unknown }).data);
            if (rowTenantId === undefined) {
              throw new TenantGuardRejection(`${model}.create is missing tenantId in data.`);
            }
            if (rowTenantId !== tenantId) {
              throw new TenantGuardRejection(`${model}.create's tenantId does not match the authoritative tenant context.`);
            }
            validateNestedCreates((args as { data?: unknown }).data, tenantId, model);
            return query(args);
          }

          if (operation === "createMany") {
            const rows = (args as { data?: unknown }).data;
            if (!Array.isArray(rows) || rows.length === 0) {
              throw new TenantGuardRejection(`${model}.createMany requires a non-empty data array.`);
            }
            for (const row of rows) {
              const rowTenantId = readTenantId(row);
              if (rowTenantId === undefined || rowTenantId !== tenantId) {
                throw new TenantGuardRejection(
                  `${model}.createMany contains a row whose tenantId is missing or does not match the authoritative tenant context.`
                );
              }
            }
            return query(args);
          }

          if (operation === "upsert" || REJECT_UNIQUE_MUTATION_OPERATIONS.has(operation)) {
            throw new TenantGuardRejection(
              `${model}.${operation} (unique-only where) is not supported for tenant-scoped models by this guard — use the "Many" variant with an explicit tenantId filter instead.`
            );
          }

          if (PRE_CHECK_WHERE_OPERATIONS.has(operation)) {
            const where = (args as { where?: { tenantId?: unknown } }).where;
            const whereTenantId = where?.tenantId;
            if (whereTenantId === undefined) {
              throw new TenantGuardRejection(`${model}.${operation} is missing a tenantId filter in where.`);
            }
            if (whereTenantId !== tenantId) {
              throw new TenantGuardRejection(
                `${model}.${operation}'s tenantId filter does not match the authoritative tenant context.`
              );
            }
            return query(args);
          }

          if (POST_CHECK_RESULT_OPERATIONS.has(operation)) {
            const result = await query(args);
            if (result == null) {
              return result;
            }
            const resultTenantId = readTenantId(result);
            if (resultTenantId !== tenantId) {
              if (operation === "findUniqueOrThrow") {
                throw new TenantGuardRejection(`${model}.findUniqueOrThrow resolved a row belonging to a different tenant.`);
              }
              return null; // findUnique: cross-tenant match treated as not-found, matching existing not-found discipline
            }
            return result;
          }

          throw new TenantGuardRejection(`${model}.${operation} is not a recognized operation for this tenant guard.`);
        },
      },
    },
  });
}
