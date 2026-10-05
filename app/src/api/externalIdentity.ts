import { prisma } from "../db/client";

// External identity mapping (docs/decisions/ratified.md, AUTHN-2 / AUTHN-5,
// Step 4 — mapping only). No HTTP authentication, no session creation, no
// cookies, no routes here — this module answers exactly one question:
// given a verified (issuer, subject) pair, which internal User/tenant
// does it map to, if any?
//
// AUTHN-2: (issuer, subject) is the ONLY authoritative external identity
// key. Email, name, or any other claim is never accepted by this module
// and never used for lookup, matching, or fallback — the function
// signature below has no email parameter at all, which is what actually
// makes that guarantee structural rather than a convention to remember.
//
// AUTHN-5: users are pre-provisioned; no JIT. This module NEVER creates a
// User, ExternalIdentity, or Tenant — an unmapped pair always fails
// closed. The eventual provisioning flow (an administrator manually
// mapping a verified (issuer, subject) after inspecting a server-side log
// — see the ratified bootstrap procedure) is a separate, later, isolated
// concern; this module only ever reads.

export interface ResolvedIdentity {
  userId: string;
  tenantId: string;
}

/** Returned for an unmapped (issuer, subject) — a routine, expected outcome (e.g. before an administrator has provisioned the mapping), never an exception. */
export const UNKNOWN_EXTERNAL_IDENTITY = "unknown-external-identity" as const;

export type ResolveExternalIdentityResult =
  | { status: "resolved"; identity: ResolvedIdentity }
  | { status: typeof UNKNOWN_EXTERNAL_IDENTITY };

/**
 * Raised only when an ExternalIdentity row exists but its mapped User
 * cannot be resolved — a data-consistency failure, not a normal "unknown
 * identity" case (which is a return value, not a throw). The schema's FK
 * (ON DELETE RESTRICT, enforced at insert time too) makes this
 * structurally unreachable today; this exists so the mapping layer fails
 * closed rather than manufacturing a User/Tenant if that invariant were
 * ever violated by some other means, instead of trusting a relational
 * `include` to quietly paper over it.
 */
export class ExternalIdentityConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalIdentityConsistencyError";
  }
}

/**
 * Resolves a verified (issuer, subject) pair to the internal User/tenant
 * it maps to, if a pre-provisioned mapping exists. Tenant identity comes
 * exclusively from the mapped User's own tenantId — never accepted from
 * OIDC claims, the browser, or derived from email/domain.
 */
export async function resolveExternalIdentity(issuer: string, subject: string): Promise<ResolveExternalIdentityResult> {
  const mapping = await prisma.externalIdentity.findUnique({
    where: { issuer_subject: { issuer, subject } },
  });

  if (!mapping) {
    return { status: UNKNOWN_EXTERNAL_IDENTITY };
  }

  const user = await prisma.user.findUnique({ where: { id: mapping.userId } });
  if (!user) {
    throw new ExternalIdentityConsistencyError(
      `ExternalIdentity ${mapping.id} references User ${mapping.userId}, which could not be resolved.`
    );
  }

  return {
    status: "resolved",
    identity: { userId: user.id, tenantId: user.tenantId },
  };
}
