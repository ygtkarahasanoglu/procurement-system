import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client";
import {
  grantProvisioningCapability,
  GrantValidationError,
  UserNotFoundError,
  UserTenantInconsistentError,
  CapabilityAlreadyGrantedError,
} from "../src/scripts/grantProvisioningCapability";

// AUTHN-5 (docs/decisions/ratified.md): bootstrap implementation form.
// Real PostgreSQL, matching this repository's existing convention for
// operator-script tests (see provisionExternalIdentity.test.ts) — this
// file owns a dedicated Tenant/User fixture set and cleans up everything
// it creates in afterAll. Deliberately does NOT exercise the CLI wrapper
// (process.argv/main()) — only the pure, exported function, which is
// where all of the behavior this decision cares about lives. This file
// is independent of provisionExternalIdentity.test.ts (different script,
// different fixtures) — proving the two mechanisms remain genuinely
// distinct, not just documented as such.

describe("grantProvisioningCapability (AUTHN-5 bootstrap implementation form)", () => {
  let tenantId: string;
  let userId: string;
  let alreadyCapableUserId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "AUTHN-5 Bootstrap Test Tenant" } });
    tenantId = tenant.id;
    userId = (
      await prisma.user.create({ data: { tenantId, name: "AUTHN-5 Bootstrap Test User", role: "procurement_user" } })
    ).id;
    alreadyCapableUserId = (
      await prisma.user.create({
        data: {
          tenantId,
          name: "AUTHN-5 Already-Capable User",
          role: "approver",
          canProvisionExternalIdentities: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, alreadyCapableUserId] } } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("1. an existing User with the capability currently false is granted it", async () => {
    const result = await grantProvisioningCapability({ userId });

    expect(result).toEqual({ userId, tenantId, canProvisionExternalIdentities: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.canProvisionExternalIdentities).toBe(true);
  });

  it("2. a missing User fails closed and creates nothing", async () => {
    const userCountBefore = await prisma.user.count();

    await expect(
      grantProvisioningCapability({ userId: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow(UserNotFoundError);

    expect(await prisma.user.count()).toBe(userCountBefore); // no User was created
  });

  it("3. a User whose Tenant cannot be resolved fails closed rather than creating a Tenant", async () => {
    // User.tenantId is a required, FK-enforced relation — a genuinely
    // tenant-less User is unconstructable in real Postgres, so the
    // internal lookup is stubbed for this one test only, matching the
    // same technique provisionExternalIdentity.test.ts already uses for
    // its own structurally-unreachable defensive branch.
    const freshUser = await prisma.user.create({
      data: { tenantId, name: "AUTHN-5 Stub Target User", role: "procurement_user" },
    });
    const originalFindUnique = prisma.user.findUnique;
    prisma.user.findUnique = (async () => ({
      id: freshUser.id,
      tenantId,
      tenant: null,
      name: "stubbed",
      role: "procurement_user",
      canProvisionExternalIdentities: false,
      createdAt: new Date(),
    })) as unknown as typeof prisma.user.findUnique;

    const tenantCountBefore = await prisma.tenant.count();
    try {
      await expect(grantProvisioningCapability({ userId: freshUser.id })).rejects.toThrow(UserTenantInconsistentError);
    } finally {
      prisma.user.findUnique = originalFindUnique;
      await prisma.user.deleteMany({ where: { id: freshUser.id } });
    }
    expect(await prisma.tenant.count()).toBe(tenantCountBefore); // no Tenant was created
  });

  it("4. a User who already has the capability fails closed — no silent idempotent no-op", async () => {
    await expect(grantProvisioningCapability({ userId: alreadyCapableUserId })).rejects.toThrow(
      CapabilityAlreadyGrantedError
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: alreadyCapableUserId } });
    expect(row.canProvisionExternalIdentities).toBe(true); // unchanged, not re-written
  });

  it("5. a repeat invocation on the same User (now capable, from test 1) also fails closed", async () => {
    await expect(grantProvisioningCapability({ userId })).rejects.toThrow(CapabilityAlreadyGrantedError);
  });

  it("6. empty/missing userId fails closed with a validation error, before any database write", async () => {
    await expect(grantProvisioningCapability({ userId: "" })).rejects.toThrow(GrantValidationError);
    await expect(grantProvisioningCapability({ userId: "   " })).rejects.toThrow(GrantValidationError);
  });

  it("7. this script never modifies User.role or creates/modifies any ExternalIdentity", async () => {
    const target = await prisma.user.create({
      data: { tenantId, name: "AUTHN-5 Role Untouched User", role: "approver" },
    });
    const identityCountBefore = await prisma.externalIdentity.count();

    await grantProvisioningCapability({ userId: target.id });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.role).toBe("approver"); // unchanged
    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore); // unchanged

    await prisma.user.deleteMany({ where: { id: target.id } });
  });

  it("8. two concurrent invocations for the same User: exactly one succeeds, the other fails closed with CapabilityAlreadyGrantedError", async () => {
    const target = await prisma.user.create({
      data: { tenantId, name: "AUTHN-5 Concurrency Test User", role: "procurement_user" },
    });

    const results = await Promise.allSettled([
      grantProvisioningCapability({ userId: target.id }),
      grantProvisioningCapability({ userId: target.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CapabilityAlreadyGrantedError);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.canProvisionExternalIdentities).toBe(true);

    await prisma.user.deleteMany({ where: { id: target.id } });
  });
});
