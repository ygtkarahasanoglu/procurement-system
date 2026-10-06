import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client";
import {
  provisionExternalIdentity,
  ProvisioningValidationError,
  UserNotFoundError,
  IdentityAlreadyMappedError,
} from "../src/scripts/provisionExternalIdentity";

// AUTHN-12 (docs/decisions/ratified.md): pilot-only operator provisioning.
// Real PostgreSQL, matching this repository's existing convention for
// identity-mapping tests (see externalIdentity.test.ts) — this file owns
// a dedicated Tenant/User fixture set and cleans up everything it creates
// in afterAll. Deliberately does NOT exercise the CLI wrapper
// (process.argv/main()) — only the pure, exported provisioning function,
// which is where all of the behavior this decision cares about lives.

const ISSUER = "https://accounts.google.com";

describe("provisionExternalIdentity (AUTHN-12 pilot operator provisioning)", () => {
  let tenantId: string;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "AUTHN-12 Provisioning Test Tenant" } });
    tenantId = tenant.id;
    userId = (
      await prisma.user.create({ data: { tenantId, name: "AUTHN-12 Provisioning Test User", role: "procurement_user" } })
    ).id;
    otherUserId = (
      await prisma.user.create({ data: { tenantId, name: "AUTHN-12 Provisioning Other User", role: "procurement_user" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("1. existing User + existing Tenant + new identity -> creates exactly one ExternalIdentity", async () => {
    const identityCountBefore = await prisma.externalIdentity.count();
    const subject = "pilot-subject-success-001";

    const result = await provisionExternalIdentity({ userId, issuer: ISSUER, subject });

    expect(result).toEqual({ id: result.id, issuer: ISSUER, subject, userId, tenantId });
    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore + 1);
    const row = await prisma.externalIdentity.findUnique({ where: { issuer_subject: { issuer: ISSUER, subject } } });
    expect(row?.userId).toBe(userId);
  });

  it("2. a missing User fails closed and creates nothing", async () => {
    const identityCountBefore = await prisma.externalIdentity.count();
    const userCountBefore = await prisma.user.count();

    await expect(
      provisionExternalIdentity({ userId: "00000000-0000-0000-0000-000000000000", issuer: ISSUER, subject: "never-used" })
    ).rejects.toThrow(UserNotFoundError);

    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore);
    expect(await prisma.user.count()).toBe(userCountBefore); // no User was created
  });

  it("3. a User whose Tenant cannot be resolved fails closed rather than creating a Tenant", async () => {
    // User.tenantId is a required, FK-enforced relation — a genuinely
    // tenant-less User is unconstructable in real Postgres, so the
    // internal lookup is stubbed for this one test only, matching the
    // same technique externalIdentity.test.ts already uses for its own
    // structurally-unreachable defensive branch (test 11 there).
    const originalFindUnique = prisma.user.findUnique;
    prisma.user.findUnique = (async () => ({
      id: userId,
      tenantId,
      tenant: null,
      name: "stubbed",
      role: "procurement_user",
      createdAt: new Date(),
    })) as unknown as typeof prisma.user.findUnique;

    const tenantCountBefore = await prisma.tenant.count();
    try {
      await expect(
        provisionExternalIdentity({ userId, issuer: ISSUER, subject: "pilot-subject-inconsistent-tenant" })
      ).rejects.toThrow("has no resolvable Tenant");
    } finally {
      prisma.user.findUnique = originalFindUnique;
    }
    expect(await prisma.tenant.count()).toBe(tenantCountBefore); // no Tenant was created
  });

  it("4. an identity already mapped to a DIFFERENT User fails closed and does not reassign it", async () => {
    const subject = "pilot-subject-conflict-002";
    await provisionExternalIdentity({ userId: otherUserId, issuer: ISSUER, subject });

    await expect(provisionExternalIdentity({ userId, issuer: ISSUER, subject })).rejects.toThrow(IdentityAlreadyMappedError);

    const row = await prisma.externalIdentity.findUnique({ where: { issuer_subject: { issuer: ISSUER, subject } } });
    expect(row?.userId).toBe(otherUserId); // unchanged — never reassigned to the second caller
  });

  it("5. an identity already mapped to the SAME User fails closed — no silent idempotent no-op", async () => {
    const subject = "pilot-subject-same-user-003";
    await provisionExternalIdentity({ userId, issuer: ISSUER, subject });

    const identityCountBefore = await prisma.externalIdentity.count();
    await expect(provisionExternalIdentity({ userId, issuer: ISSUER, subject })).rejects.toThrow(IdentityAlreadyMappedError);
    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore); // no duplicate, no silent success
  });

  it("6. provisioning is never keyed by email — the function has no email parameter, so an email claim can never influence or satisfy a lookup", async () => {
    // Structural guarantee, not behavior to compute: ProvisionExternalIdentityInput
    // has exactly {userId, issuer, subject} — there is no email field to
    // even attempt an email-based match with, matching the same
    // structural boundary externalIdentity.ts's resolveExternalIdentity
    // already relies on for AUTHN-2.
    const subject = "pilot-subject-no-email-004";
    const result = await provisionExternalIdentity({ userId, issuer: ISSUER, subject });
    expect(Object.keys(result).sort()).toEqual(["id", "issuer", "subject", "tenantId", "userId"]);
  });

  it("7. empty/missing userId, issuer, or subject fail closed with a validation error, before any database write", async () => {
    const identityCountBefore = await prisma.externalIdentity.count();

    await expect(provisionExternalIdentity({ userId: "", issuer: ISSUER, subject: "x" })).rejects.toThrow(
      ProvisioningValidationError
    );
    await expect(provisionExternalIdentity({ userId, issuer: "", subject: "x" })).rejects.toThrow(ProvisioningValidationError);
    await expect(provisionExternalIdentity({ userId, issuer: ISSUER, subject: "" })).rejects.toThrow(
      ProvisioningValidationError
    );

    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore);
  });
});
