import { Router, type Request, type Response } from "express";
import { serialize, parse } from "cookie";
import { discoverProvider, buildAuthorizationRequest, exchangeAuthorizationCode } from "./oidc";
import { resolveExternalIdentity, UNKNOWN_EXTERNAL_IDENTITY } from "./externalIdentity";
import { createSession } from "./session";

// Browser OIDC login/callback transaction (docs/decisions/ratified.md,
// AUTHN-1..AUTHN-11, Step 5). Builds a standalone, independently testable
// Express Router — NOT mounted into createApp/server.ts, and the existing
// Authenticator/authentication middleware are untouched. Wiring this
// router into the running application, making any existing API route
// authenticated, and adding /auth/me or /auth/logout are all explicitly
// later, separate steps.
//
// Every cryptographic/protocol validation step (PKCE, state, nonce,
// signature, issuer, audience, expiration) is delegated entirely to the
// existing generic OIDC module (oidc.ts) — nothing here re-implements or
// duplicates that. Identity resolution is delegated entirely to the
// existing external identity mapper (externalIdentity.ts) — this file
// never queries User/Tenant/ExternalIdentity directly. Session creation is
// delegated entirely to the existing session module (session.ts) — this
// file never touches the Session table directly.
//
// Error handling is deliberately coarse and uniform: every authentication-
// relevant failure (invalid/missing/expired transaction, state mismatch,
// OIDC exchange/verification failure, unknown external identity, or an
// internal identity-consistency failure) produces the exact same generic
// 401 response — the browser is never given a way to distinguish "your
// crypto failed" from "you authenticated but aren't provisioned" from
// "state didn't match". Configuration/provider-unavailability issues are a
// distinct, non-identity-related failure class and surface as 500.
// Detailed diagnostics go to server-side logs only, and never include a
// raw token, authorization code, PKCE verifier, state, nonce, or session
// token — only (issuer, subject, email) is ever logged, and only for the
// "unknown identity" case, per the ratified manual-provisioning workflow.

const TRANSACTION_COOKIE_NAME = "oidc_txn";
const SESSION_COOKIE_NAME = "session";
const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000; // ~10 minutes
const SESSION_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // ~14 days, matching session.ts's own absolute expiry
const OIDC_SCOPE = "openid email";
/** Fixed post-login destination — no arbitrary returnTo/open-redirect support exists anywhere in this module. */
const POST_LOGIN_REDIRECT_PATH = "/";

const GENERIC_AUTH_FAILURE = { error: "AuthenticationFailed", message: "The login attempt could not be completed." };
const GENERIC_CONFIG_FAILURE = { error: "ConfigurationError", message: "Authentication is not available." };

export class MissingOidcConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingOidcConfigurationError";
  }
}

export interface OidcEnvConfig {
  issuerUrl: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Reads OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET /
 * OIDC_REDIRECT_URI from the environment. Fails closed (throws) if any is
 * missing or OIDC_ISSUER_URL is not a valid URL — this function never
 * falls back to another provider or a localhost default.
 */
export function loadOidcConfigFromEnv(): OidcEnvConfig {
  const issuerUrlRaw = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;

  if (!issuerUrlRaw || !clientId || !clientSecret || !redirectUri) {
    throw new MissingOidcConfigurationError(
      "OIDC configuration is incomplete: OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI must all be set."
    );
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuerUrlRaw);
  } catch {
    throw new MissingOidcConfigurationError("OIDC_ISSUER_URL is not a valid URL.");
  }

  return { issuerUrl, clientId, clientSecret, redirectUri };
}

interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

function isOidcTransaction(value: unknown): value is OidcTransaction {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OidcTransaction).state === "string" &&
    typeof (value as OidcTransaction).nonce === "string" &&
    typeof (value as OidcTransaction).codeVerifier === "string" &&
    typeof (value as OidcTransaction).expiresAt === "number"
  );
}

function serializeTransactionCookie(transaction: OidcTransaction): string {
  return serialize(TRANSACTION_COOKIE_NAME, JSON.stringify(transaction), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth",
    maxAge: Math.round(TRANSACTION_LIFETIME_MS / 1000),
  });
}

function clearTransactionCookie(): string {
  return serialize(TRANSACTION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth",
    maxAge: 0,
  });
}

function readTransactionCookie(req: Request): OidcTransaction | null {
  const header = req.headers.cookie;
  if (!header) return null;

  let cookies: Record<string, string | undefined>;
  try {
    cookies = parse(header);
  } catch {
    return null;
  }

  const raw = cookies[TRANSACTION_COOKIE_NAME];
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isOidcTransaction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeSessionCookie(rawToken: string, expiresAt: Date): string {
  return serialize(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  });
}

/** Never logs a raw token, authorization code, PKCE verifier, state, nonce, or session token — only non-secret diagnostic context. */
function logServerSideFailure(stage: string, err: unknown): void {
  console.error(`[auth] ${stage}:`, err instanceof Error ? err.message : err);
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get("/login", async (_req: Request, res: Response) => {
    let config: OidcEnvConfig;
    try {
      config = loadOidcConfigFromEnv();
    } catch (err) {
      logServerSideFailure("configuration error on /auth/login", err);
      res.status(500).json(GENERIC_CONFIG_FAILURE);
      return;
    }

    let configuration;
    let authorizationRequest;
    try {
      configuration = await discoverProvider({
        issuer: config.issuerUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
      authorizationRequest = await buildAuthorizationRequest({
        configuration,
        redirectUri: config.redirectUri,
        scope: OIDC_SCOPE,
      });
    } catch (err) {
      logServerSideFailure("provider discovery/authorization-request error on /auth/login", err);
      res.status(500).json(GENERIC_CONFIG_FAILURE);
      return;
    }

    const transaction: OidcTransaction = {
      state: authorizationRequest.state,
      nonce: authorizationRequest.nonce,
      codeVerifier: authorizationRequest.codeVerifier,
      expiresAt: Date.now() + TRANSACTION_LIFETIME_MS,
    };

    res.setHeader("Set-Cookie", serializeTransactionCookie(transaction));
    res.redirect(302, authorizationRequest.url.toString());
  });

  router.get("/callback", async (req: Request, res: Response) => {
    const transaction = readTransactionCookie(req);
    const clearTxnCookie = clearTransactionCookie();

    if (!transaction || transaction.expiresAt <= Date.now()) {
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(401).json(GENERIC_AUTH_FAILURE);
      return;
    }

    let config: OidcEnvConfig;
    try {
      config = loadOidcConfigFromEnv();
    } catch (err) {
      logServerSideFailure("configuration error on /auth/callback", err);
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(500).json(GENERIC_CONFIG_FAILURE);
      return;
    }

    let configuration;
    try {
      configuration = await discoverProvider({
        issuer: config.issuerUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
    } catch (err) {
      logServerSideFailure("provider discovery error on /auth/callback", err);
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(500).json(GENERIC_CONFIG_FAILURE);
      return;
    }

    // The trusted origin comes from server configuration (redirectUri),
    // never from a request header such as Host, which a client controls.
    const callbackUrl = new URL(req.originalUrl, config.redirectUri);

    let identity;
    try {
      identity = await exchangeAuthorizationCode({
        configuration,
        callbackUrl,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      });
    } catch (err) {
      logServerSideFailure("OIDC exchange/verification failure on /auth/callback", err);
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(401).json(GENERIC_AUTH_FAILURE);
      return;
    }

    let resolution;
    try {
      resolution = await resolveExternalIdentity(identity.issuer, identity.subject);
    } catch (err) {
      // ExternalIdentityConsistencyError or any other resolution failure —
      // folded into the same generic response as every other failure
      // class, so the browser can never distinguish "valid OIDC identity,
      // but our own data is inconsistent" from any other failure.
      logServerSideFailure("external identity resolution failure on /auth/callback", err);
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(401).json(GENERIC_AUTH_FAILURE);
      return;
    }

    if (resolution.status === UNKNOWN_EXTERNAL_IDENTITY) {
      // Per the ratified manual-provisioning workflow: log the verified
      // (issuer, subject, email) server-side only — never returned to the
      // browser, never used to create anything.
      console.error(
        `[auth] unknown external identity attempted login: issuer=${identity.issuer} subject=${identity.subject} email=${identity.email ?? "(none)"}`
      );
      res.setHeader("Set-Cookie", clearTxnCookie);
      res.status(401).json(GENERIC_AUTH_FAILURE);
      return;
    }

    const session = await createSession(resolution.identity.userId);

    res.setHeader("Set-Cookie", [clearTxnCookie, serializeSessionCookie(session.rawToken, session.expiresAt)]);
    res.redirect(302, POST_LOGIN_REDIRECT_PATH);
  });

  return router;
}
