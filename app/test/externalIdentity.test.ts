import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client";
import {
  resolveExternalIdentity,
  UNKNOWN_EXTERNAL_IDENTITY,
  ExternalIdentityConsistencyError,
} from "../src/api/externalIdentity";

// External identity mapping tests (AUTHN-2 / AUTHN-5, Step 4). Real
// PostgreSQL, per this repository's existing convention — persistence
// behavior (uniqueness, cross-tenant distinctness, no-side-effects-on-
// unknown-identity) is proved against the real datastore. This file owns
// a dedicated Tenant/User/ExternalIdentity fixture set and cleans up
// everything it creates in afterAll.
//
// Note on "email" in the test names below: ExternalIdentity has no email
// column at all (AUTHN-2 — email is never part of the identity key), so
// "email mismatch doesn't matter" / "same email doesn't grant access" are
// structural guarantees here, not behavior this module computes — these
// tests exist as regression protection against a future change that might
// mistakenly introduce email-based matching.

const ISSUER_A = "https://accounts.google.com";
const SUBJECT_A = "google-subject-AAA111";
const ISSUER_B = "https://login.microsoftonline.com/some-tenant-id/v2.0";
const SUBJECT_B = "entra-subject-BBB222";

describe("resolveExternalIdentity", () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "External Identity Test Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "External Identity Test Tenant B" } });
    tenantBId = tenantB.id;

    userAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "External Identity Test User A", role: "procurement_user" } })
    ).id;
    userBId = (
      await prisma.user.create({ data: { tenantId: tenantBId, name: "External Identity Test User B", role: "procurement_user" } })
    ).id;

    await prisma.externalIdentity.create({ data: { issuer: ISSUER_A, subject: SUBJECT_A, userId: userAId } });
    await prisma.externalIdentity.create({ data: { issuer: ISSUER_B, subject: SUBJECT_B, userId: userBId } });
  });

  afterAll(async () => {
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  });

  it("1. a known (issuer, subject) resolves to the correct userId and tenantId", async () => {
    const result = await resolveExternalIdentity(ISSUER_A, SUBJECT_A);
    expect(result).toEqual({ status: "resolved", identity: { userId: userAId, tenantId: tenantAId } });
  });

  it("2. the same subject value under a different issuer does NOT resolve", async () => {
    // SUBJECT_A is mapped only under ISSUER_A — pairing it with ISSUER_B
    // (which has its own, different, mapped subject) must not resolve.
    const result = await resolveExternalIdentity(ISSUER_B, SUBJECT_A);
    expect(result).toEqual({ status: UNKNOWN_EXTERNAL_IDENTITY });
  });

  it("3. the same issuer with a different subject does NOT resolve", async () => {
    const result = await resolveExternalIdentity(ISSUER_A, "a-subject-that-was-never-mapped");
    expect(result).toEqual({ status: UNKNOWN_EXTERNAL_IDENTITY });
  });

  it("4. resolution depends only on (issuer, subject) — the function has no email parameter, so an email claim can never influence the result", async () => {
    // resolveExternalIdentity(issuer, subject) — there is no third
    // argument to even attempt an email-based override with. Calling it
    // with exactly the mapped pair succeeds regardless of whatever email
    // claim the OIDC layer (oidc.ts) separately obtained.
    const result = await resolveExternalIdentity(ISSUER_A, SUBJECT_A);
    expect(result.status).toBe("resolved");
  });

  it("5. two identities that might conceptually share the same email remain distinct and independent, since ExternalIdentity stores no email at all", async () => {
    const resultA = await resolveExternalIdentity(ISSUER_A, SUBJECT_A);
    const resultB = await resolveExternalIdentity(ISSUER_B, SUBJECT_B);

    expect(resultA).toEqual({ status: "resolved", identity: { userId: userAId, tenantId: tenantAId } });
    expect(resultB).toEqual({ status: "resolved", identity: { userId: userBId, tenantId: tenantBId } });
    expect(resultA).not.toEqual(resultB);
  });

  it("6. an unknown (issuer, subject) returns the explicit unknown-identity result", async () => {
    const result = await resolveExternalIdentity("https://unknown-issuer.example", "nonexistent-subject");
    expect(result).toEqual({ status: UNKNOWN_EXTERNAL_IDENTITY });
  });

  it("7-9. an unknown identity never creates a User, ExternalIdentity, or Tenant as a side effect", async () => {
    const userCountBefore = await prisma.user.count();
    const identityCountBefore = await prisma.externalIdentity.count();
    const tenantCountBefore = await prisma.tenant.count();

    const result = await resolveExternalIdentity("https://another-unknown-issuer.example", "another-nonexistent-subject");
    expect(result).toEqual({ status: UNKNOWN_EXTERNAL_IDENTITY });

    expect(await prisma.user.count()).toBe(userCountBefore);
    expect(await prisma.externalIdentity.count()).toBe(identityCountBefore);
    expect(await prisma.tenant.count()).toBe(tenantCountBefore);
  });

  it("10. the resolved tenantId comes exclusively from the mapped User's own tenantId", async () => {
    const result = await resolveExternalIdentity(ISSUER_A, SUBJECT_A);
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: userAId } });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.identity.tenantId).toBe(userRow.tenantId);
    }
  });

  it("11. if the mapped User cannot be resolved, the lookup fails closed rather than manufacturing a User/Tenant", async () => {
    // The schema's FK (ON DELETE RESTRICT, enforced at insert time too)
    // makes a genuinely dangling ExternalIdentity -> User reference
    // unconstructable in real Postgres, so the second internal lookup is
    // stubbed for this one test only, to exercise the defensive branch in
    // isolation — everything else in this file uses the real database.
    // Direct property reassignment (not vi.spyOn/mockRestore) is used
    // because Prisma 6's client model delegates are Proxy-based and do
    // not reliably survive vitest's spy-restore cycle.
    const originalFindUnique = prisma.user.findUnique;
    prisma.user.findUnique = (async () => null) as unknown as typeof prisma.user.findUnique;
    try {
      await expect(resolveExternalIdentity(ISSUER_A, SUBJECT_A)).rejects.toThrow(ExternalIdentityConsistencyError);
    } finally {
      prisma.user.findUnique = originalFindUnique;
    }

    // And no User/Tenant was manufactured as a fallback.
    const userCount = await prisma.user.count({ where: { id: userAId } });
    expect(userCount).toBe(1); // the real, pre-existing userA row — unchanged, not duplicated
  });

  it("12. the mapping can never substitute or override the User's stored tenantId", async () => {
    const result = await resolveExternalIdentity(ISSUER_A, SUBJECT_A);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.identity.tenantId).toBe(tenantAId);
      expect(result.identity.tenantId).not.toBe(tenantBId);
    }
  });
});
