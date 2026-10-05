import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Unit tests for the generic OIDC verification module (AUTHN implementation
// plan, Step 1). No real Google credentials, no network access, no browser,
// no frontend — the `openid-client` library boundary itself is mocked where
// a real call would require network I/O (discovery, the authorization
// endpoint, the token endpoint). Pure/local functions (random generation,
// PKCE challenge derivation) are exercised against the REAL library, since
// they do no I/O and testing them for real gives genuine confidence.
//
// Per vitest's hoisting rules, variables referenced inside a vi.mock()
// factory must be prefixed with "mock".
const mockDiscovery = vi.fn();
const mockBuildAuthorizationUrl = vi.fn();
const mockAuthorizationCodeGrant = vi.fn();

vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return {
    ...actual,
    discovery: (...args: unknown[]) => mockDiscovery(...args),
    buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
    authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  };
});

import {
  generateState,
  generateNonce,
  generatePkceCodeVerifier,
  derivePkceCodeChallenge,
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  discoverProvider,
  type OidcConfiguration,
} from "../src/api/oidc";

function expectedS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// A fake Configuration is never passed to the real openid-client functions
// in these tests (buildAuthorizationUrl/authorizationCodeGrant/discovery
// are all mocked) — it only needs to satisfy TypeScript's parameter type.
const fakeConfiguration = {} as OidcConfiguration;

beforeEach(() => {
  mockDiscovery.mockReset();
  mockBuildAuthorizationUrl.mockReset();
  mockAuthorizationCodeGrant.mockReset();
});

describe("generateState / generateNonce / generatePkceCodeVerifier (real, no mocking — pure local crypto)", () => {
  it("1. produce non-empty, appropriately random values that differ call to call", () => {
    const state1 = generateState();
    const state2 = generateState();
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    const verifier1 = generatePkceCodeVerifier();
    const verifier2 = generatePkceCodeVerifier();

    for (const value of [state1, state2, nonce1, nonce2, verifier1, verifier2]) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(20);
    }
    expect(state1).not.toBe(state2);
    expect(nonce1).not.toBe(nonce2);
    expect(verifier1).not.toBe(verifier2);
  });
});

describe("derivePkceCodeChallenge (real, no mocking)", () => {
  it("2. derives the RFC 7636 S256 challenge correctly from a known verifier", async () => {
    const verifier = "a-fixed-test-verifier-value-for-deterministic-comparison";
    const challenge = await derivePkceCodeChallenge(verifier);
    expect(challenge).toBe(expectedS256Challenge(verifier));
  });
});

describe("buildAuthorizationRequest", () => {
  it("3. authorization parameters contain every required security parameter", async () => {
    mockBuildAuthorizationUrl.mockImplementation((_config: unknown, params: Record<string, string>) => {
      const url = new URL("https://authorization-server.example/authorize");
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url;
    });

    const result = await buildAuthorizationRequest({
      configuration: fakeConfiguration,
      redirectUri: "https://app.example/auth/callback",
      scope: "openid email",
    });

    expect(mockBuildAuthorizationUrl).toHaveBeenCalledTimes(1);
    const [, paramsArg] = mockBuildAuthorizationUrl.mock.calls[0];
    expect(paramsArg).toMatchObject({
      redirect_uri: "https://app.example/auth/callback",
      scope: "openid email",
      code_challenge_method: "S256",
    });
    expect(typeof paramsArg.state).toBe("string");
    expect(paramsArg.state.length).toBeGreaterThan(0);
    expect(typeof paramsArg.nonce).toBe("string");
    expect(paramsArg.nonce.length).toBeGreaterThan(0);
    expect(typeof paramsArg.code_challenge).toBe("string");
    expect(paramsArg.code_challenge).toBe(await derivePkceCodeChallenge(result.codeVerifier));

    // The function's own returned state/nonce/codeVerifier must be exactly
    // what was sent to buildAuthorizationUrl — never regenerated/divergent.
    expect(result.state).toBe(paramsArg.state);
    expect(result.nonce).toBe(paramsArg.nonce);
    expect(result.url.toString()).toContain("authorization-server.example");
  });
});

describe("discoverProvider", () => {
  it("wires issuer/clientId/clientSecret through to openid-client's discovery() correctly", async () => {
    mockDiscovery.mockResolvedValue(fakeConfiguration);
    const issuer = new URL("https://accounts.google.com");

    await discoverProvider({ issuer, clientId: "test-client-id", clientSecret: "test-client-secret" });

    expect(mockDiscovery).toHaveBeenCalledTimes(1);
    const [issuerArg, clientIdArg, metadataArg, clientAuthArg] = mockDiscovery.mock.calls[0];
    expect(issuerArg).toBe(issuer);
    expect(clientIdArg).toBe("test-client-id");
    expect(metadataArg).toBeUndefined();
    expect(typeof clientAuthArg).toBe("function"); // ClientSecretPost(...) returns a function
  });
});

describe("exchangeAuthorizationCode", () => {
  const baseParams = {
    configuration: fakeConfiguration,
    callbackUrl: new URL("https://app.example/auth/callback?code=abc&state=xyz"),
    expectedState: "xyz",
    expectedNonce: "expected-nonce-value",
    codeVerifier: "test-code-verifier-value",
  };

  it("4. passes the expected PKCE code_verifier (and state/nonce) through to the token exchange", async () => {
    mockAuthorizationCodeGrant.mockResolvedValue({
      claims: () => ({ iss: "https://issuer.example", sub: "subject-123" }),
    });

    await exchangeAuthorizationCode(baseParams);

    expect(mockAuthorizationCodeGrant).toHaveBeenCalledTimes(1);
    const [, , checksArg] = mockAuthorizationCodeGrant.mock.calls[0];
    expect(checksArg).toEqual({
      expectedState: baseParams.expectedState,
      expectedNonce: baseParams.expectedNonce,
      pkceCodeVerifier: baseParams.codeVerifier,
    });
  });

  it("5. propagates rejection when openid-client reports a nonce mismatch — never swallowed into a fake success", async () => {
    const nonceError = new Error("unexpected JWT \"nonce\" claim value");
    mockAuthorizationCodeGrant.mockRejectedValue(nonceError);

    await expect(exchangeAuthorizationCode(baseParams)).rejects.toBe(nonceError);
  });

  it("6. propagates rejection when openid-client reports invalid issuer, audience, or expiration — delegated validation, never re-implemented here", async () => {
    const issuerError = new Error("unexpected JWT \"iss\" (issuer) claim value");
    const audienceError = new Error("unexpected JWT \"aud\" (audience) claim value");
    const expiredError = new Error("\"exp\" claim timestamp check failed (JWT expired)");

    for (const err of [issuerError, audienceError, expiredError]) {
      mockAuthorizationCodeGrant.mockRejectedValueOnce(err);
      await expect(exchangeAuthorizationCode(baseParams)).rejects.toBe(err);
    }
  });

  it("7. a successful exchange exposes only verified issuer + subject + optional email claims", async () => {
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: "should-never-appear-in-the-result",
      id_token: "should-never-appear-in-the-result",
      claims: () => ({
        iss: "https://accounts.google.com",
        sub: "verified-subject-id",
        aud: "test-client-id",
        iat: 1700000000,
        exp: 1700003600,
        nonce: baseParams.expectedNonce,
        email: "pilot-user@example.com",
        email_verified: true,
      }),
    });

    const identity = await exchangeAuthorizationCode(baseParams);

    expect(identity).toEqual({
      issuer: "https://accounts.google.com",
      subject: "verified-subject-id",
      email: "pilot-user@example.com",
      emailVerified: true,
    });
  });

  it("8. the public identity result never contains a raw token or authorization code", async () => {
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: "should-never-appear-in-the-result",
      id_token: "should-never-appear-in-the-result",
      refresh_token: "should-never-appear-in-the-result",
      claims: () => ({
        iss: "https://accounts.google.com",
        sub: "verified-subject-id",
        email: "pilot-user@example.com",
        email_verified: true,
      }),
    });

    const identity = await exchangeAuthorizationCode(baseParams);

    expect(Object.keys(identity).sort()).toEqual(["email", "emailVerified", "issuer", "subject"]);
    expect(identity).not.toHaveProperty("access_token");
    expect(identity).not.toHaveProperty("id_token");
    expect(identity).not.toHaveProperty("refresh_token");
    expect(identity).not.toHaveProperty("code");
    expect(JSON.stringify(identity)).not.toContain("should-never-appear-in-the-result");
  });

  it("9. never logs the code_verifier, state, nonce, or any token, on either the success or failure path", async () => {
    const secretVerifier = "super-secret-pkce-verifier-marker-9f3a";
    const secretParams = { ...baseParams, codeVerifier: secretVerifier };

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      mockAuthorizationCodeGrant.mockResolvedValueOnce({
        access_token: "secret-access-token-marker",
        claims: () => ({ iss: "https://accounts.google.com", sub: "subject-123" }),
      });
      await exchangeAuthorizationCode(secretParams);

      mockAuthorizationCodeGrant.mockRejectedValueOnce(new Error("token exchange failed"));
      await expect(exchangeAuthorizationCode(secretParams)).rejects.toThrow();

      for (const spy of [logSpy, warnSpy, errorSpy, infoSpy]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});
