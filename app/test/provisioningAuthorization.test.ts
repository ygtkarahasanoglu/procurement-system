import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client";
import { assertProvisioningAuthorized, AuthorizationError } from "../src/domain/authorization";
import { NotFoundError } from "../src/domain/errors";

// AUTHN-5 (docs/decisions/ratified.md) — application-level provisioning
// authorization. Covers only the new, narrow authorization boundary
// (assertProvisioningAuthorized / User.canProvisionExternalIdentities) —
// no route, no UI, no bootstrap mechanism exists yet, by design (see the
// ratified decision's own scope). Regression coverage for
// assertActorAuthorized (existing procurement authorization) and
// provisionExternalIdentity (existing ExternalIdentity conflict/
// reassignment protections) is intentionally not duplicated here — both
// are already covered by adversarial.test.ts / tenantGuard.test.ts and
// provisionExternalIdentity.test.ts respectively, and this file's own
// job is only to prove those are unaffected by running unchanged
// alongside this one.
describe("AUTHN-5 provisioning authorization (assertProvisioningAuthorized)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let provisionerUserId: string;
  let nonProvisionerUserId: string;
  let approverUserId: string;
  let targetInTenantAId: string;
  let targetInTenantBId: string;

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "ProvisioningAuth Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "ProvisioningAuth Tenant B" } });
    tenantBId = tenantB.id;

    provisionerUserId = (
      await prisma.user.create({
        data: { tenantId: tenantAId, name: "Provisioner", role: "procurement_user", canProvisionExternalIdentities: true },
      })
    ).id;
    nonProvisionerUserId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "Non-Provisioner", role: "procurement_user" } })
    ).id;
    approverUserId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "Approver Only", role: "approver" } })
    ).id;
    targetInTenantAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "Target In A", role: "procurement_user" } })
    ).id;
    targetInTenantBId = (
      await prisma.user.create({ data: { tenantId: tenantBId, name: "Target In B", role: "procurement_user" } })
    ).id;
  });

  // 1. User defaults to false.
  it("1. a newly-created User defaults to canProvisionExternalIdentities: false", async () => {
    expect(nonProvisionerUserId).toBeDefined();
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: nonProvisionerUserId } });
    expect(fresh.canProvisionExternalIdentities).toBe(false);
  });

  // 2. User with capability false cannot pass provisioning authorization.
  it("2. a User with canProvisionExternalIdentities: false is rejected with AuthorizationError", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, nonProvisionerUserId, targetInTenantAId)
    ).rejects.toThrow(AuthorizationError);
  });

  // 3. User with capability true can authorize an in-tenant target.
  it("3. a User with canProvisionExternalIdentities: true authorizes an in-tenant target", async () => {
    const result = await assertProvisioningAuthorized(tenantAId, provisionerUserId, targetInTenantAId);
    expect(result.actor.id).toBe(provisionerUserId);
    expect(result.target.id).toBe(targetInTenantAId);
  });

  // 4. User with capability true cannot authorize a cross-tenant target.
  it("4. a User with canProvisionExternalIdentities: true is rejected for a cross-tenant target, indistinguishable from not-found", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, provisionerUserId, targetInTenantBId)
    ).rejects.toThrow(NotFoundError);
  });

  // 5. Procurement role alone does not grant provisioning capability.
  it("5. an 'approver' role alone does not grant provisioning authority", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, approverUserId, targetInTenantAId)
    ).rejects.toThrow(AuthorizationError);
  });

  it("a nonexistent acting User is rejected with NotFoundError, not a raw error", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, "00000000-0000-0000-0000-000000000000", targetInTenantAId)
    ).rejects.toThrow(NotFoundError);
  });

  it("an actor from tenant B cannot be used to authorize provisioning in tenant A (actor itself is cross-tenant)", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, targetInTenantBId, targetInTenantAId)
    ).rejects.toThrow(NotFoundError);
  });

  it("a nonexistent target User is rejected with NotFoundError", async () => {
    await expect(
      assertProvisioningAuthorized(tenantAId, provisionerUserId, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow(NotFoundError);
  });
});
