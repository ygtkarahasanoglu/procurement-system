import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma, tenantScoped, TenantGuardRejection } from "../src/db/client";
import * as rfqDispatchService from "../src/services/rfqDispatchService";
import { NotFoundError } from "../src/domain/errors";
import { hashToken, generateRawToken } from "../src/api/rfqResponseToken";

// RFQ Batch 2 — the internal, tenant-scoped RFQDispatch domain service.
// Prepare/create side only (SEC-014): no token generation, no email, no
// supplier-facing endpoint exist yet. These tests exercise the real test
// database, following this repo's existing convention (productSupplier
// .test.ts, tenantGuard.test.ts) of proving tenant isolation against
// real Prisma execution rather than a mock.
describe("RFQDispatch domain service (Batch 2 — prepare/create only)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let supplierAId: string;
  let supplierBId: string;
  let sourcingEventAId: string;
  let sourcingEventBId: string;

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "RFQDispatch Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "RFQDispatch Tenant B" } });
    tenantBId = tenantB.id;

    const userA = await prisma.user.create({
      data: { tenantId: tenantAId, name: "RFQDispatch Test User A", role: "procurement_user" },
    });

    const productA = await prisma.product.create({
      data: { tenantId: tenantAId, name: "RFQDispatch Product A", sku: "RFQD-PRODUCT-A" },
    });
    const productB = await prisma.product.create({
      data: { tenantId: tenantBId, name: "RFQDispatch Product B", sku: "RFQD-PRODUCT-B" },
    });

    supplierAId = (await prisma.supplier.create({ data: { tenantId: tenantAId, name: "RFQDispatch Supplier A" } })).id;
    supplierBId = (await prisma.supplier.create({ data: { tenantId: tenantBId, name: "RFQDispatch Supplier B" } })).id;

    const requestA = await prisma.procurementRequest.create({
      data: { tenantId: tenantAId, createdById: userA.id },
    });
    const lineA = await prisma.requestLine.create({
      data: { tenantId: tenantAId, requestId: requestA.id, productId: productA.id, requestedQuantity: "10", unit: "EA" },
    });
    sourcingEventAId = (await prisma.sourcingEvent.create({ data: { tenantId: tenantAId, requestLineId: lineA.id } })).id;

    const userB = await prisma.user.create({
      data: { tenantId: tenantBId, name: "RFQDispatch Test User B", role: "procurement_user" },
    });
    const requestB = await prisma.procurementRequest.create({
      data: { tenantId: tenantBId, createdById: userB.id },
    });
    const lineB = await prisma.requestLine.create({
      data: { tenantId: tenantBId, requestId: requestB.id, productId: productB.id, requestedQuantity: "5", unit: "EA" },
    });
    sourcingEventBId = (await prisma.sourcingEvent.create({ data: { tenantId: tenantBId, requestLineId: lineB.id } })).id;
  });

  // ---------------------------------------------------------------
  // 1, 8, 9. Creates a valid RFQDispatch: PENDING, no token fields set
  // ---------------------------------------------------------------
  it("1. creates an RFQDispatch in PENDING for a same-tenant SourcingEvent/Supplier pair", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    expect(dispatch.status).toBe("PENDING");
    expect(dispatch.tenantId).toBe(tenantAId);
    expect(dispatch.sourcingEventId).toBe(sourcingEventAId);
    expect(dispatch.supplierId).toBe(supplierAId);
  });

  it("8-9. responseTokenHash and tokenExpiresAt remain null — no token lifecycle implemented in this batch", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    expect(dispatch.responseTokenHash).toBeNull();
    expect(dispatch.tokenExpiresAt).toBeNull();
    expect(dispatch.respondedAt).toBeNull();
  });

  // ---------------------------------------------------------------
  // 2. Created row's tenantId is exactly the trusted parameter — there
  // is no other channel (e.g. a body field) through which a caller could
  // influence it; tenantScoped() itself would reject any mismatch.
  // ---------------------------------------------------------------
  it("2. the created row's tenantId is exactly the (trusted, Principal-derived) tenantId argument", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    expect(dispatch.tenantId).toBe(tenantAId);
  });

  // ---------------------------------------------------------------
  // 3-6. Cross-tenant / nonexistent SourcingEvent or Supplier rejected
  // identically (NotFoundError), never distinguished.
  // ---------------------------------------------------------------
  it("3. rejects a SourcingEvent belonging to a different tenant", async () => {
    await expect(rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventBId, supplierAId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("4. rejects a Supplier belonging to a different tenant", async () => {
    await expect(rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierBId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("5. rejects a nonexistent SourcingEvent", async () => {
    await expect(rfqDispatchService.createRFQDispatch(tenantAId, randomUUID(), supplierAId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("6. rejects a nonexistent Supplier", async () => {
    await expect(rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, randomUUID())).rejects.toThrow(
      NotFoundError
    );
  });

  it("neither cross-tenant rejection creates a row", async () => {
    const before = await prisma.rFQDispatch.count({ where: { sourcingEventId: sourcingEventAId } });
    await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventBId, supplierAId).catch(() => undefined);
    const after = await prisma.rFQDispatch.count({ where: { sourcingEventId: sourcingEventAId } });
    expect(after).toBe(before);
  });

  // ---------------------------------------------------------------
  // 7. RFQ resend policy is OPEN — multiple dispatches for the same
  // SourcingEvent/Supplier pair must both succeed, as distinct rows.
  // ---------------------------------------------------------------
  it("7. allows multiple RFQDispatch rows for the same SourcingEvent/Supplier pair (resend policy remains OPEN)", async () => {
    const first = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    const second = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    expect(first.id).not.toBe(second.id);
    expect(first.sourcingEventId).toBe(second.sourcingEventId);
    expect(first.supplierId).toBe(second.supplierId);
  });

  // ---------------------------------------------------------------
  // 10-11. No external side effect; routes through tenantScoped(), not
  // the bare prisma client — proven by source inspection, the same
  // convention productSupplier.test.ts already uses for createProduct/
  // createSupplier.
  // ---------------------------------------------------------------
  it("10. the service's implementation contains no email/transport/external-call code", async () => {
    const source = await readFile(join(__dirname, "../src/services/rfqDispatchService.ts"), "utf-8");
    expect(source).not.toMatch(/\b(fetch|http|https|smtp|mailer|sendMail|axios)\b/i);
  });

  it("11. the service's implementation routes through tenantScoped(), not the bare prisma client", async () => {
    const source = await readFile(join(__dirname, "../src/services/rfqDispatchService.ts"), "utf-8");
    expect(source).toMatch(/tenantScoped\(/);
    expect(source).not.toMatch(/\bprisma\.rFQDispatch\.create/);
  });

  it("11b. tenantScoped() itself rejects a tenant-mismatched RFQDispatch create (the guard is real, not merely imported)", async () => {
    const db = tenantScoped(tenantBId);
    await expect(
      db.rFQDispatch.create({
        data: { tenantId: tenantAId, sourcingEventId: sourcingEventAId, supplierId: supplierAId },
      })
    ).rejects.toThrow(TenantGuardRejection);
  });

  // ---------------------------------------------------------------
  // 12. A cross-tenant RFQDispatch cannot be read through tenantScoped()
  // — both the pre-check (findFirst) and post-check (findUnique) paths.
  // ---------------------------------------------------------------
  it("12. an RFQDispatch cannot be read cross-tenant through tenantScoped() — findFirst", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    const db = tenantScoped(tenantBId);
    await expect(db.rFQDispatch.findFirst({ where: { id: dispatch.id, tenantId: tenantBId } })).resolves.toBeNull();
  });

  it("12b. an RFQDispatch cannot be read cross-tenant through tenantScoped() — findUnique", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
    const db = tenantScoped(tenantBId);
    await expect(db.rFQDispatch.findUnique({ where: { id: dispatch.id } })).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------
// RFQ Batch 3 — issueResponseToken: generate + hash + persist only.
// No HTTP route, no email, no consumption/verification exist yet — see
// the Batch 3 assessment for why issuance is deliberately unwired from
// both RFQDispatch creation and any future SEND step.
// ---------------------------------------------------------------
describe("RFQDispatch domain service — issueResponseToken (Batch 3 — issuance only)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let supplierAId: string;
  let sourcingEventAId: string;
  let dispatchAId: string;

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "RFQToken Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "RFQToken Tenant B" } });
    tenantBId = tenantB.id;

    const userA = await prisma.user.create({
      data: { tenantId: tenantAId, name: "RFQToken Test User A", role: "procurement_user" },
    });
    const productA = await prisma.product.create({
      data: { tenantId: tenantAId, name: "RFQToken Product A", sku: "RFQT-PRODUCT-A" },
    });
    supplierAId = (await prisma.supplier.create({ data: { tenantId: tenantAId, name: "RFQToken Supplier A" } })).id;

    const requestA = await prisma.procurementRequest.create({ data: { tenantId: tenantAId, createdById: userA.id } });
    const lineA = await prisma.requestLine.create({
      data: { tenantId: tenantAId, requestId: requestA.id, productId: productA.id, requestedQuantity: "10", unit: "EA" },
    });
    sourcingEventAId = (await prisma.sourcingEvent.create({ data: { tenantId: tenantAId, requestLineId: lineA.id } })).id;

    dispatchAId = (await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId)).id;
  });

  it("issues a token for a valid tenant + PENDING RFQDispatch", async () => {
    const { rawToken, tokenExpiresAt } = await rfqDispatchService.issueResponseToken(tenantAId, dispatchAId);

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
    expect(row.responseTokenHash).not.toBeNull();
    // The returned raw token must never equal the persisted hash...
    expect(rawToken).not.toBe(row.responseTokenHash);
    // ...but hashing it must match exactly what was persisted.
    expect(hashToken(rawToken)).toBe(row.responseTokenHash);
    expect(row.tokenExpiresAt?.getTime()).toBe(tokenExpiresAt.getTime());
  });

  it("does not disturb the RFQDispatch's other fields — status stays PENDING, respondedAt stays null", async () => {
    await rfqDispatchService.issueResponseToken(tenantAId, dispatchAId);
    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });

    expect(row.status).toBe("PENDING");
    expect(row.respondedAt).toBeNull();
    expect(row.sourcingEventId).toBe(sourcingEventAId);
    expect(row.supplierId).toBe(supplierAId);
    expect(row.tenantId).toBe(tenantAId);
  });

  it("rejects a nonexistent RFQDispatch", async () => {
    await expect(rfqDispatchService.issueResponseToken(tenantAId, randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("rejects a cross-tenant RFQDispatch — identical to nonexistent, no cross-tenant info leaked", async () => {
    let nonexistentError: unknown;
    let crossTenantError: unknown;
    try {
      await rfqDispatchService.issueResponseToken(tenantAId, randomUUID());
    } catch (err) {
      nonexistentError = err;
    }
    try {
      await rfqDispatchService.issueResponseToken(tenantBId, dispatchAId);
    } catch (err) {
      crossTenantError = err;
    }

    expect(nonexistentError).toBeInstanceOf(NotFoundError);
    expect(crossTenantError).toBeInstanceOf(NotFoundError);
    expect((crossTenantError as Error).message).not.toMatch(/tenant/i);
  });

  it("a cross-tenant issuance attempt does not modify the dispatch at all", async () => {
    const before = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
    await rfqDispatchService.issueResponseToken(tenantBId, dispatchAId).catch(() => undefined);
    const after = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
    expect(after.responseTokenHash).toBe(before.responseTokenHash);
    expect(after.tokenExpiresAt?.getTime()).toBe(before.tokenExpiresAt?.getTime());
  });

  // ---------------------------------------------------------------
  // Rotation: a second issuance replaces the first token. This is
  // ONLY a rotation mechanic — it does not decide resend, single-use,
  // or quote-revision policy (all remain OPEN).
  // ---------------------------------------------------------------
  it("rotation: a second issuance produces a different raw token and hash, invalidating the first", async () => {
    const first = await rfqDispatchService.issueResponseToken(tenantAId, dispatchAId);
    const second = await rfqDispatchService.issueResponseToken(tenantAId, dispatchAId);

    expect(second.rawToken).not.toBe(first.rawToken);

    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
    expect(row.responseTokenHash).toBe(hashToken(second.rawToken));
    expect(row.responseTokenHash).not.toBe(hashToken(first.rawToken));
  });

  // ---------------------------------------------------------------
  // Genuine tenant-guard exercise (not merely application-level
  // preconditions) — directly mirrors the fix for Batch 2's own
  // MEDIUM finding: a tenant-mismatched update must be rejected by
  // tenantScoped() itself, independent of the service's own check.
  // ---------------------------------------------------------------
  it("tenantScoped() itself rejects a tenant-mismatched RFQDispatch update (the guard is real, not merely imported)", async () => {
    const db = tenantScoped(tenantBId);
    await expect(
      db.rFQDispatch.updateMany({
        where: { id: dispatchAId, tenantId: tenantAId },
        data: { responseTokenHash: hashToken(generateRawToken()), tokenExpiresAt: new Date() },
      })
    ).rejects.toThrow(TenantGuardRejection);
  });

  it("routes through tenantScoped(), not the bare prisma client, for the update itself", async () => {
    const source = await readFile(join(__dirname, "../src/services/rfqDispatchService.ts"), "utf-8");
    expect(source).not.toMatch(/\bprisma\.rFQDispatch\.updateMany/);
  });
});
