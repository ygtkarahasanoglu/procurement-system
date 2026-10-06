import { prisma } from "../db/client";

// AUTHN-12 (docs/decisions/ratified.md): pilot-only operator provisioning
// for the Google OIDC pilot's first user. This module maps a verified
// (issuer, subject) pair to an ALREADY-EXISTING User — it never creates a
// User, never creates a Tenant, never looks up by email (the function
// signature below has no email parameter at all — the same structural
// guarantee externalIdentity.ts already relies on for AUTHN-2), and is
// never invoked from any login/OIDC code path. This is a one-time,
// out-of-band operator action, run directly against the database by
// someone who already holds operator/database access — it is not an
// admin API, not an admin UI, and introduces no new authorization
// concept. It does NOT decide, implement, or narrow the production
// provisioning mechanism — AUTHN-5 remains open.

export class ProvisioningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningValidationError";
  }
}

/** The referenced User does not exist. Never creates one — pre-provisioned only (AUTHN-5). */
export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User "${userId}" does not exist. This script never creates a User.`);
    this.name = "UserNotFoundError";
  }
}

/**
 * Defensive-only: User.tenantId is a required, FK-enforced relation, so
 * this is structurally unreachable via normal Prisma usage — kept for the
 * same reason externalIdentity.ts's ExternalIdentityConsistencyError
 * exists: fail closed rather than silently proceeding if that invariant
 * were ever violated by some other means.
 */
export class UserTenantInconsistentError extends Error {
  constructor(userId: string) {
    super(`User "${userId}" has no resolvable Tenant. This script never creates a Tenant.`);
    this.name = "UserTenantInconsistentError";
  }
}

/**
 * The (issuer, subject) pair is already mapped — to this same User or to
 * a different one. Either way this is a hard failure: there is no silent
 * idempotent no-op, and an existing mapping to a different User is never
 * reassigned or overwritten.
 */
export class IdentityAlreadyMappedError extends Error {
  readonly sameUser: boolean;
  constructor(issuer: string, subject: string, sameUser: boolean) {
    super(
      sameUser
        ? `(issuer, subject) is already mapped to this User — not re-creating.`
        : `(issuer, subject) is already mapped to a different User — refusing to reassign.`
    );
    this.name = "IdentityAlreadyMappedError";
    this.sameUser = sameUser;
  }
}

export interface ProvisionExternalIdentityInput {
  userId: string;
  issuer: string;
  subject: string;
}

export interface ProvisionedIdentity {
  id: string;
  issuer: string;
  subject: string;
  userId: string;
  tenantId: string;
}

/**
 * Maps a verified (issuer, subject) pair to an already-existing User.
 * Fails closed on every case other than "exactly one new mapping for an
 * existing User, to an existing Tenant, with no prior conflicting
 * mapping" — see the error classes above for each failure mode.
 */
export async function provisionExternalIdentity(
  input: ProvisionExternalIdentityInput
): Promise<ProvisionedIdentity> {
  const userId = input.userId?.trim();
  const issuer = input.issuer?.trim();
  const subject = input.subject?.trim();

  if (!userId) throw new ProvisioningValidationError("userId is required.");
  if (!issuer) throw new ProvisioningValidationError("issuer is required.");
  if (!subject) throw new ProvisioningValidationError("subject is required.");

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
  if (!user) {
    throw new UserNotFoundError(userId);
  }
  if (!user.tenant) {
    throw new UserTenantInconsistentError(userId);
  }

  const existing = await prisma.externalIdentity.findUnique({
    where: { issuer_subject: { issuer, subject } },
  });
  if (existing) {
    throw new IdentityAlreadyMappedError(issuer, subject, existing.userId === user.id);
  }

  const created = await prisma.externalIdentity.create({
    data: { issuer, subject, userId: user.id },
  });

  return { id: created.id, issuer: created.issuer, subject: created.subject, userId: user.id, tenantId: user.tenantId };
}

function parseArgs(argv: string[]): Partial<ProvisionExternalIdentityInput> {
  const result: Partial<ProvisionExternalIdentityInput> = {};
  for (const arg of argv) {
    const match = /^--(userId|issuer|subject)=(.*)$/.exec(arg);
    if (match) {
      result[match[1] as keyof ProvisionExternalIdentityInput] = match[2];
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userId || !args.issuer || !args.subject) {
    console.error(
      "Usage: tsx src/scripts/provisionExternalIdentity.ts --userId=<id> --issuer=<issuer> --subject=<subject>"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await provisionExternalIdentity({ userId: args.userId, issuer: args.issuer, subject: args.subject });
    console.log("Provisioned ExternalIdentity:");
    console.log(
      JSON.stringify(
        { id: result.id, issuer: result.issuer, subject: result.subject, userId: result.userId, tenantId: result.tenantId },
        null,
        2
      )
    );
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
