import * as client from "openid-client";

// Generic, provider-agnostic OIDC primitives (AUTHN implementation plan,
// Step 1 — see docs/decisions/ratified.md, AUTHN-1 through AUTHN-11).
//
// This module contains NO Google-specific identity semantics — it only
// wraps openid-client's own discovery / PKCE / Authorization Code Grant
// API generically, so a future provider swap (per AUTHN-1's requirement
// that the implementation stay generic at the protocol/claims boundary)
// never requires touching this file. Provider-specific values (issuer,
// client id, client secret, redirect URI) are supplied by the caller as
// plain configuration — never read from environment variables here.
//
// Security delegation (ratified requirement, not optional): all
// cryptographic work — PKCE challenge derivation, ID-token signature
// verification, JWKS fetching/rotation, issuer/audience/expiration/nonce
// validation — is delegated entirely to openid-client's own
// `authorizationCodeGrant`. Nothing in this file hand-rolls any of that;
// a rejection from openid-client propagates unmodified, it is never
// caught and downgraded to a "soft" failure.
//
// No routes, no sessions, no Prisma, no frontend changes belong here —
// this module only produces a verified identity tuple from a completed
// OIDC exchange; everything else is a later, separate implementation step.

/** Provider-agnostic configuration needed to discover an OIDC issuer. */
export interface OidcProviderConfig {
  issuer: URL;
  clientId: string;
  /** Omit for a public client; a confidential client (e.g. Google) requires it. */
  clientSecret?: string;
}

/** Re-exported for callers that need to hold a discovered configuration. */
export type OidcConfiguration = client.Configuration;

/**
 * Performs OIDC discovery against the given issuer (Authorization Server
 * Metadata discovery — never hard-coded authorization/token/JWKS endpoints,
 * per the ratified requirement). The returned Configuration is what every
 * other function in this module operates against.
 */
export async function discoverProvider(config: OidcProviderConfig): Promise<OidcConfiguration> {
  const clientAuthentication = config.clientSecret !== undefined ? client.ClientSecretPost(config.clientSecret) : undefined;
  return client.discovery(config.issuer, config.clientId, undefined, clientAuthentication);
}

export interface AuthorizationRequestParams {
  configuration: OidcConfiguration;
  redirectUri: string;
  /** e.g. "openid email" — the caller decides the exact scope string. */
  scope: string;
}

export interface AuthorizationRequest {
  /** The URL the browser must be redirected to. */
  url: URL;
  /** Generated with cryptographically secure randomness; must be bound to the browser and compared on callback. */
  state: string;
  /** Generated with cryptographically secure randomness; must be bound to the browser and compared against the ID token's nonce claim on callback. */
  nonce: string;
  /** The PKCE code_verifier — must remain secret until the token exchange and must never be logged. */
  codeVerifier: string;
}

/** Generates a cryptographically secure `state` value. Exposed separately for direct testability. */
export function generateState(): string {
  return client.randomState();
}

/** Generates a cryptographically secure `nonce` value. Exposed separately for direct testability. */
export function generateNonce(): string {
  return client.randomNonce();
}

/** Generates a cryptographically secure PKCE `code_verifier`. Exposed separately for direct testability. */
export function generatePkceCodeVerifier(): string {
  return client.randomPKCECodeVerifier();
}

/** Derives the S256 PKCE `code_challenge` from a `code_verifier`. Exposed separately for direct testability. */
export async function derivePkceCodeChallenge(codeVerifier: string): Promise<string> {
  return client.calculatePKCECodeChallenge(codeVerifier);
}

/**
 * Builds a complete authorization request: a fresh state/nonce/PKCE pair
 * (each cryptographically random and unique per call) and the resulting
 * authorization URL. `buildAuthorizationUrl` itself adds `client_id` and
 * `response_type` for the Authorization Code flow automatically; this
 * function additionally supplies `state`, `nonce`, `code_challenge`, and
 * `code_challenge_method: "S256"` — all of the security parameters the
 * ratified requirements list.
 */
export async function buildAuthorizationRequest(params: AuthorizationRequestParams): Promise<AuthorizationRequest> {
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generatePkceCodeVerifier();
  const codeChallenge = await derivePkceCodeChallenge(codeVerifier);

  const url = client.buildAuthorizationUrl(params.configuration, {
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { url, state, nonce, codeVerifier };
}

/**
 * Raised when a completed OIDC exchange did not yield claims this module
 * can extract an identity from. Deliberately local to this module (an
 * API-layer/protocol-level concern, not a domain rule) rather than added
 * to domain/errors.ts.
 */
export class OidcVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcVerificationError";
  }
}

/**
 * The only shape this module ever returns as "identity." Deliberately
 * contains nothing else: no access/refresh/id token, no authorization
 * code. `issuer`+`subject` is the identity key (AUTHN-2) — `email`/
 * `emailVerified` are display-only claims, never used as an identity key
 * by this module or by any caller relying on it.
 */
export interface VerifiedOidcIdentity {
  issuer: string;
  subject: string;
  email?: string;
  emailVerified?: boolean;
}

export interface ExchangeAuthorizationCodeParams {
  configuration: OidcConfiguration;
  /** The full callback URL the browser actually requested, including the authorization server's query parameters. */
  callbackUrl: URL;
  /** The `state` this server generated and bound to the browser at /auth/login time. */
  expectedState: string;
  /** The `nonce` this server generated and bound to the browser at /auth/login time. */
  expectedNonce: string;
  /** The PKCE code_verifier generated at /auth/login time; never logged, never persisted. */
  codeVerifier: string;
}

/**
 * Exchanges an authorization code for tokens AND performs the full
 * validation openid-client's `authorizationCodeGrant` is documented to
 * perform in a single call: PKCE verification, state comparison, ID-token
 * signature verification against the discovered JWKS, issuer/audience
 * checks against the discovered Configuration, expiration validation, and
 * nonce comparison against `expectedNonce`. Any failure in any of those
 * checks causes `authorizationCodeGrant` to throw; this function never
 * catches that rejection to "soften" it — it propagates unmodified to the
 * caller, which must treat it as a hard authentication failure.
 */
export async function exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<VerifiedOidcIdentity> {
  const tokens = await client.authorizationCodeGrant(params.configuration, params.callbackUrl, {
    expectedState: params.expectedState,
    expectedNonce: params.expectedNonce,
    pkceCodeVerifier: params.codeVerifier,
  });

  return extractVerifiedIdentity(tokens);
}

function extractVerifiedIdentity(tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers): VerifiedOidcIdentity {
  const claims = tokens.claims();
  if (!claims) {
    throw new OidcVerificationError("Token endpoint response did not include a verifiable ID token.");
  }

  const email = typeof claims.email === "string" ? claims.email : undefined;
  const emailVerified = typeof claims.email_verified === "boolean" ? claims.email_verified : undefined;

  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    emailVerified,
  };
}
