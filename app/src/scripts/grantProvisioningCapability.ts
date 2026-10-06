import { prisma } from "../db/client";

// AUTHN-5 (docs/decisions/ratified.md): bootstrap implementation form.
// Grants the already-ratified application-level provisioning capability
// (User.canProvisionExternalIdentities) to an already-existing User —
// intended for establishing the FIRST such User for a tenant, per the
// ratified bootstrap semantics. This is a standalone, out-of-band
// operator action: deliberately independent of, and never importing or
// calling into, AUTHN-12's provisionExternalIdentity.ts — a distinct
// mechanism, per that decision's own explicit boundary. It never creates
// a User or Tenant, never creates or modifies an ExternalIdentity row
// (identity provisioning remains exclusively AUTHN-12's/the production
// mechanism's concern), and never reads or writes User.role or any
// existing procurement-authorization state. It is not reachable from any
// login/HTTP path, exposes no route or UI, and is run directly, out of
// band, by whoever already holds database/operator access — exactly
// like every other script in this directory. No silent idempotent
// no-op: granting an already-true capability fails closed, so a
// mistaken repeat invocation is never mistaken for a first grant.
//
// Does NOT decide or implement: subsequent grant/revoke lifecycle,
// invitations, SCIM, a tenant-admin concept, multiple provisioning
// actors, or operator access management — all remain OPEN
// (docs/decisions/open.md).

export class GrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantValidationError";
  }
}

/** The referenced User does not exist. Never creates one — this script only grants a capability on an already-existing User. */
export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User "${userId}" does not exist. This script never creates a User.`);
    this.name = "UserNotFoundError";
  }
}

/**
 * Defensive-only: User.tenantId is a required, FK-enforced relation, so
 * this is structurally unreachable via normal Prisma usage — kept for
 * the same reason provisionExternalIdentity.ts's UserTenantInconsistentError
 * exists: fail closed rather than silently proceeding if that invariant
 * were ever violated by some other means.
 */
export class UserTenantInconsistentError extends Error {
  constructor(userId: string) {
    super(`User "${userId}" has no resolvable Tenant. This script never creates a Tenant.`);
    this.name = "UserTenantInconsistentError";
  }
}

/** The target User already has the capability. No silent idempotent no-op — a repeat invocation is a hard failure, not a mistaken success. */
export class CapabilityAlreadyGrantedError extends Error {
  constructor(userId: string) {
    super(`User "${userId}" already has canProvisionExternalIdentities = true — not re-granting.`);
    this.name = "CapabilityAlreadyGrantedError";
  }
}

export interface GrantProvisioningCapabilityInput {
  userId: string;
}

export interface GrantedProvisioningCapability {
  userId: string;
  tenantId: string;
  canProvisionExternalIdentities: true;
}

/**
 * Grants the application-level provisioning capability to an
 * already-existing User. Fails closed on every case other than "exactly
 * one existing User, with a resolvable Tenant, whose capability is
 * currently false" — see the error classes above for each failure mode.
 */
export async function grantProvisioningCapability(
  input: GrantProvisioningCapabilityInput
): Promise<GrantedProvisioningCapability> {
  const userId = input.userId?.trim();
  if (!userId) {
    throw new GrantValidationError("userId is required.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
  if (!user) {
    throw new UserNotFoundError(userId);
  }
  if (!user.tenant) {
    throw new UserTenantInconsistentError(userId);
  }
  if (user.canProvisionExternalIdentities) {
    throw new CapabilityAlreadyGrantedError(userId);
  }

  // Atomic conditional update (the same updateMany-with-a-matching-where
  // idiom already used elsewhere in this codebase, e.g.
  // decisionService.ts's freezeDecisionPackage): the write only affects a
  // row that still has canProvisionExternalIdentities: false at the
  // moment it runs. If a concurrent invocation already won this race and
  // flipped it to true, `count` is 0 here, and this invocation fails
  // closed with the same CapabilityAlreadyGrantedError the pre-check
  // above already uses — it is never possible for two concurrent calls
  // on the same User to both report success.
  const result = await prisma.user.updateMany({
    where: { id: userId, canProvisionExternalIdentities: false },
    data: { canProvisionExternalIdentities: true },
  });
  if (result.count === 0) {
    throw new CapabilityAlreadyGrantedError(userId);
  }

  return { userId: user.id, tenantId: user.tenantId, canProvisionExternalIdentities: true };
}

function parseArgs(argv: string[]): Partial<GrantProvisioningCapabilityInput> {
  const result: Partial<GrantProvisioningCapabilityInput> = {};
  for (const arg of argv) {
    const match = /^--(userId)=(.*)$/.exec(arg);
    if (match) {
      result[match[1] as keyof GrantProvisioningCapabilityInput] = match[2];
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId) {
    console.error("Usage: tsx src/scripts/grantProvisioningCapability.ts --userId=<id>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await grantProvisioningCapability({ userId: args.userId });
    console.log("Granted provisioning capability:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
