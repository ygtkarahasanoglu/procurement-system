import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../db/client";

// Server-side session infrastructure (docs/decisions/ratified.md, AUTHN-4,
// Step 3 — persistence primitive only). No cookie handling, no routes, no
// Authenticator wiring here — those are later, separate steps. This module
// never logs or persists a raw session token: only its SHA-256 hash is
// ever written to the database (Session.tokenHash); the raw token exists
// solely as this module's return value from createSession, for a later
// step to place in a browser cookie.
//
// Absolute expiry only, per AUTHN-4: no idle-timeout enforcement in this
// phase. lastSeenAt is recorded as an activity marker but never used to
// extend expiresAt, and a lookup never extends expiresAt either.

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // ~14 days, per AUTHN-4

function generateRawToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString("hex");
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface CreatedSession {
  /** The raw session token — place this in a cookie (a later step); never persisted, logged, or returned again after this call. */
  rawToken: string;
  expiresAt: Date;
}

/**
 * Creates a new session for the given user. Generates a fresh,
 * cryptographically random raw token, persists only its hash, and returns
 * the raw token to the caller — the only place it is ever available after
 * this call returns.
 */
export async function createSession(userId: string): Promise<CreatedSession> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  await prisma.session.create({
    data: { tokenHash, userId, expiresAt },
  });

  return { rawToken, expiresAt };
}

export interface ActiveSession {
  userId: string;
}

/**
 * Looks up a session by its raw token (hashing it first — the database is
 * never queried by raw token). Returns null for a nonexistent OR expired
 * session; an expired session's expiresAt is never extended, and this
 * function never distinguishes "expired" from "never existed" to the
 * caller, consistent with this codebase's existing not-found discipline.
 */
export async function findActiveSessionByRawToken(rawToken: string): Promise<ActiveSession | null> {
  const tokenHash = hashToken(rawToken);

  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  // Activity marker only — never alters expiresAt (no idle timeout in this
  // phase). Best-effort: the session was already confirmed valid above, so
  // a failure to record this (e.g. a concurrent revocation) must not turn
  // an otherwise-valid lookup result into a failure.
  await prisma.session
    .update({ where: { tokenHash }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return { userId: session.userId };
}

/**
 * Revokes a session by its raw token. Deleting a nonexistent or
 * already-revoked session is a safe no-op (idempotent) — this function
 * never throws for that case. No broader "revoke all sessions for this
 * user" behavior exists here.
 */
export async function revokeSessionByRawToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}
