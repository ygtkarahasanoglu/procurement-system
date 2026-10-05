import type { Request } from "express";
import { parse } from "cookie";
import { prisma } from "../db/client";
import { findActiveSessionByRawToken } from "./session";
import type { Authenticator, Principal } from "./principal";

// Session-backed Authenticator (docs/decisions/ratified.md, AUTHN-1..AUTHN-11,
// Step 6A). Implements the existing Authenticator type by resolving the
// browser's session cookie to a Principal:
//
//   session cookie -> findActiveSessionByRawToken (session.ts, unchanged)
//   -> User lookup by session.userId -> User.tenantId
//   -> Principal { userId, tenantId }
//
// This module reimplements NO session hashing or expiry logic — all of that
// remains exclusively in session.ts, called here unchanged. tenantId is
// never read from the cookie; it is always resolved fresh from the User row,
// per the ratified "resolve tenantId from User on every request" design
// (session.ts never stores tenantId at all). If the session's User cannot be
// resolved (e.g. a data inconsistency), this fails closed — it never
// manufactures a partial Principal.
//
// The cookie name "session" intentionally duplicates the literal already
// used in app/src/api/authRoutes.ts (SESSION_COOKIE_NAME). This is a
// deliberate, documented duplication rather than an export/import coupling
// into the already-audited Step 5 file, per the agreed scope discipline for
// this step — both occurrences must be kept in sync if this name ever
// changes.
const SESSION_COOKIE_NAME = "session"; // must match authRoutes.ts's SESSION_COOKIE_NAME

function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  let cookies: Record<string, string | undefined>;
  try {
    cookies = parse(header);
  } catch {
    return null;
  }

  const rawToken = cookies[SESSION_COOKIE_NAME];
  return rawToken && rawToken.length > 0 ? rawToken : null;
}

export const sessionAuthenticator: Authenticator = async (req: Request): Promise<Principal | null> => {
  const rawToken = readSessionCookie(req);
  if (!rawToken) return null;

  const session = await findActiveSessionByRawToken(rawToken);
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null; // fail closed — the session's User could not be resolved

  return { userId: user.id, tenantId: user.tenantId };
};
