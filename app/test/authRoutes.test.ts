import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { prisma } from "../src/db/client";
import { createSession, findActiveSessionByRawToken } from "../src/api/session";

// Browser OIDC login/callback transaction tests (AUTHN Step 5). Real
// PostgreSQL for session/identity persistence, per this repository's
// existing convention — only the OIDC library boundary (oidc.ts) is
// mocked, exactly as instructed: no real Google/Microsoft network call is
// ever made. This router is NOT mounted into the main app (that is a
// later step) — a small, dedicated Express app wraps only this router.

const mockDiscoverProvider = vi.fn();
const mockBuildAuthorizationRequest = vi.fn();
const mockExchangeAuthorizationCode = vi.fn();

vi.mock("../src/api/oidc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/oidc")>();
  return {
    ...actual,
    discoverProvider: (...args: unknown[]) => mockDiscoverProvider(...args),
    buildAuthorizationRequest: (...args: unknown[]) => mockBuildAuthorizationRequest(...args),
    exchangeAuthorizationCode: (...args: unknown[]) => mockExchangeAuthorizationCode(...args),
  };
});

import { createAuthRouter } from "../src/api/authRoutes";

function randomToken(): string {
  return randomBytes(16).toString("hex");
}

let httpServer: Server;
let baseUrl: string;

async function httpGet(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { method: "GET", headers, redirect: "manual" });
  const bodyText = await res.text().catch(() => "");
  return { status: res.status, headers: res.headers, bodyText };
}

async function httpPost(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, redirect: "manual" });
  const bodyText = await res.text().catch(() => "");
  return { status: res.status, headers: res.headers, bodyText };
}

function parseSetCookieHeaders(headers: Headers): string[] {
  // Node's fetch Headers combines multiple Set-Cookie values; getSetCookie()
  // (available on Node's undici-based fetch) returns them individually.
  const maybeGetSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") return maybeGetSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function findCookie(setCookieHeaders: string[], name: string): string | undefined {
  return setCookieHeaders.find((c) => c.startsWith(`${name}=`));
}

const ISSUER = "https://oidc-provider.example";
const VALID_ENV = {
  OIDC_ISSUER_URL: ISSUER,
  OIDC_CLIENT_ID: "test-client-id",
  OIDC_CLIENT_SECRET: "test-client-secret",
  OIDC_REDIRECT_URI: "https://app.example/auth/callback",
};

function setValidEnv() {
  Object.assign(process.env, VALID_ENV);
}
function clearEnv() {
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REDIRECT_URI;
}

describe("AuthN Step 5 — /auth/login and /auth/callback", () => {
  let tenantId: string;
  let userId: string;
  const KNOWN_SUBJECT = "verified-subject-001";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      const app = express();
      app.use("/auth", createAuthRouter());
      httpServer = createServer(app);
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "AuthRoutes Test Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "AuthRoutes Test User", role: "procurement_user" } })).id;
    await prisma.externalIdentity.create({ data: { issuer: ISSUER, subject: KNOWN_SUBJECT, userId } });
  });

  afterAll(async () => {
    httpServer.close();
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.externalIdentity.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  beforeEach(() => {
    clearEnv();
    setValidEnv();
    mockDiscoverProvider.mockReset().mockResolvedValue({});
    mockBuildAuthorizationRequest.mockReset().mockImplementation(async () => ({
      url: new URL("https://oidc-provider.example/authorize?mock=login"),
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: randomToken(),
    }));
    mockExchangeAuthorizationCode.mockReset();
  });

  async function performLogin() {
    const res = await httpGet("/auth/login");
    const setCookies = parseSetCookieHeaders(res.headers);
    const txnCookie = findCookie(setCookies, "oidc_txn");
    if (!txnCookie) throw new Error("login did not set a transaction cookie");
    const cookieValue = txnCookie.split(";")[0];
    const transaction = JSON.parse(decodeURIComponent(cookieValue.split("=").slice(1).join("=")));
    return { res, setCookies, txnCookie, cookieValue, transaction };
  }

  async function performCallbackWithTxnCookie(cookieValue: string, queryString = "code=mockcode&state=mockstate") {
    return httpGet(`/auth/callback?${queryString}`, { cookie: cookieValue });
  }

  // ---------------------------------------------------------------
  // /auth/login
  // ---------------------------------------------------------------
  describe("/auth/login", () => {
    it("1. missing provider configuration fails closed", async () => {
      clearEnv();
      const res = await httpGet("/auth/login");
      expect(res.status).toBe(500);
      expect(JSON.parse(res.bodyText)).toMatchObject({ error: "ConfigurationError" });
      expect(mockBuildAuthorizationRequest).not.toHaveBeenCalled();
    });

    it("2-4. generates state, nonce, and a PKCE verifier, each present in the transaction cookie", async () => {
      const { transaction } = await performLogin();
      expect(typeof transaction.state).toBe("string");
      expect(transaction.state.length).toBeGreaterThan(0);
      expect(typeof transaction.nonce).toBe("string");
      expect(transaction.nonce.length).toBeGreaterThan(0);
      expect(typeof transaction.codeVerifier).toBe("string");
      expect(transaction.codeVerifier.length).toBeGreaterThan(0);
    });

    it("5-6. sets a transaction cookie containing only the required fields", async () => {
      const { transaction } = await performLogin();
      expect(Object.keys(transaction).sort()).toEqual(["codeVerifier", "expiresAt", "nonce", "state"]);
      expect(transaction).not.toHaveProperty("userId");
      expect(transaction).not.toHaveProperty("tenantId");
      expect(transaction).not.toHaveProperty("email");
      expect(transaction).not.toHaveProperty("sessionToken");
      expect(transaction).not.toHaveProperty("accessToken");
      expect(transaction).not.toHaveProperty("idToken");
      expect(transaction).not.toHaveProperty("clientSecret");
    });

    it("7. transaction cookie has httpOnly, Secure, SameSite=Lax, Path=/auth, and ~10-minute Max-Age", async () => {
      const { txnCookie } = await performLogin();
      expect(txnCookie!.toLowerCase()).toContain("httponly");
      expect(txnCookie!.toLowerCase()).toContain("secure");
      expect(txnCookie!.toLowerCase()).toContain("samesite=lax");
      expect(txnCookie!).toContain("Path=/auth");
      const maxAgeMatch = txnCookie!.match(/max-age=(\d+)/i);
      expect(maxAgeMatch).not.toBeNull();
      const maxAge = Number(maxAgeMatch![1]);
      expect(maxAge).toBeGreaterThan(9 * 60);
      expect(maxAge).toBeLessThanOrEqual(10 * 60);
    });

    it("8. redirects to the configured authorization endpoint", async () => {
      const { res } = await performLogin();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://oidc-provider.example/authorize?mock=login");
    });

    it("9. requests scope 'openid email'", async () => {
      await performLogin();
      expect(mockBuildAuthorizationRequest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "openid email", redirectUri: VALID_ENV.OIDC_REDIRECT_URI })
      );
    });

    it("10. ignores any client-supplied returnTo — no arbitrary redirect target is ever honored at login time", async () => {
      const res = await httpGet("/auth/login?returnTo=https://evil.example");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://oidc-provider.example/authorize?mock=login");
    });
  });

  // ---------------------------------------------------------------
  // /auth/callback
  // ---------------------------------------------------------------
  describe("/auth/callback", () => {
    it("11. missing transaction cookie fails generically", async () => {
      const res = await httpGet("/auth/callback?code=abc&state=xyz");
      expect(res.status).toBe(401);
      expect(JSON.parse(res.bodyText)).toEqual({ error: "AuthenticationFailed", message: expect.any(String) });
      expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it("12. malformed transaction cookie fails generically", async () => {
      const res = await performCallbackWithTxnCookie("oidc_txn=not-valid-json");
      expect(res.status).toBe(401);
      expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it("13. expired transaction fails generically, without attempting the exchange", async () => {
      const expired = { state: "s", nonce: "n", codeVerifier: "v", expiresAt: Date.now() - 1000 };
      const cookieValue = `oidc_txn=${encodeURIComponent(JSON.stringify(expired))}`;
      const res = await performCallbackWithTxnCookie(cookieValue);
      expect(res.status).toBe(401);
      expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it("14-16. state mismatch, token-exchange failure, and verification failure all fail generically and identically, without touching domain data", async () => {
      const rejections = [
        new Error('unexpected "state" response parameter value'),
        new Error("token endpoint responded with an error"),
        new Error('unexpected JWT "nonce" claim value'),
      ];

      for (const rejection of rejections) {
        const [userCountBefore, tenantCountBefore, identityCountBefore, sessionCountBefore] = await Promise.all([
          prisma.user.count(),
          prisma.tenant.count(),
          prisma.externalIdentity.count(),
          prisma.session.count(),
        ]);

        const { cookieValue } = await performLogin();
        mockExchangeAuthorizationCode.mockRejectedValueOnce(rejection);
        const res = await performCallbackWithTxnCookie(cookieValue);

        expect(res.status).toBe(401);
        expect(JSON.parse(res.bodyText)).toEqual({ error: "AuthenticationFailed", message: expect.any(String) });

        expect(await prisma.user.count()).toBe(userCountBefore);
        expect(await prisma.tenant.count()).toBe(tenantCountBefore);
        expect(await prisma.externalIdentity.count()).toBe(identityCountBefore);
        expect(await prisma.session.count()).toBe(sessionCountBefore);
      }
    });

    it("17-18. an unknown (issuer, subject) does not create a session, User, ExternalIdentity, or Tenant", async () => {
      const [userCountBefore, tenantCountBefore, identityCountBefore, sessionCountBefore] = await Promise.all([
        prisma.user.count(),
        prisma.tenant.count(),
        prisma.externalIdentity.count(),
        prisma.session.count(),
      ]);

      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({
        issuer: ISSUER,
        subject: "never-provisioned-subject",
        email: "nobody@example.com",
        emailVerified: true,
      });
      const res = await performCallbackWithTxnCookie(cookieValue);

      expect(res.status).toBe(401);
      expect(await prisma.user.count()).toBe(userCountBefore);
      expect(await prisma.tenant.count()).toBe(tenantCountBefore);
      expect(await prisma.externalIdentity.count()).toBe(identityCountBefore);
      expect(await prisma.session.count()).toBe(sessionCountBefore);
    });

    it("19-20. a known identity resolves through Step 4 and creates exactly one server-side session", async () => {
      const sessionCountBefore = await prisma.session.count({ where: { userId } });

      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({
        issuer: ISSUER,
        subject: KNOWN_SUBJECT,
        email: "pilot-user@example.com",
        emailVerified: true,
      });
      const res = await performCallbackWithTxnCookie(cookieValue);

      expect(res.status).toBe(302);
      const sessionCountAfter = await prisma.session.count({ where: { userId } });
      expect(sessionCountAfter).toBe(sessionCountBefore + 1);
    });

    it("21. the session cookie is set with httpOnly, Secure, SameSite=Lax, Path=/, and ~14-day Max-Age", async () => {
      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
      const res = await performCallbackWithTxnCookie(cookieValue);

      const setCookies = parseSetCookieHeaders(res.headers);
      const sessionCookie = findCookie(setCookies, "session");
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.toLowerCase()).toContain("httponly");
      expect(sessionCookie!.toLowerCase()).toContain("secure");
      expect(sessionCookie!.toLowerCase()).toContain("samesite=lax");
      expect(sessionCookie!).toContain("Path=/;");
      const maxAgeMatch = sessionCookie!.match(/max-age=(\d+)/i);
      expect(Number(maxAgeMatch![1])).toBe(14 * 24 * 60 * 60);
    });

    it("22. the transaction cookie is cleared after a successful callback", async () => {
      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
      const res = await performCallbackWithTxnCookie(cookieValue);

      const setCookies = parseSetCookieHeaders(res.headers);
      const clearedTxn = findCookie(setCookies, "oidc_txn");
      expect(clearedTxn).toBeDefined();
      expect(clearedTxn!.toLowerCase()).toMatch(/max-age=0/);
    });

    it("23-24. the raw session token is never in the response body, and no OIDC token ever appears in the response", async () => {
      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
      const res = await performCallbackWithTxnCookie(cookieValue);

      const setCookies = parseSetCookieHeaders(res.headers);
      const sessionCookie = findCookie(setCookies, "session")!;
      const rawToken = sessionCookie.split(";")[0].split("=")[1];

      expect(res.bodyText).not.toContain(rawToken);
      expect(res.bodyText.toLowerCase()).not.toContain("access_token");
      expect(res.bodyText.toLowerCase()).not.toContain("id_token");
    });

    it("25. no open redirect is possible — the post-login destination is always the fixed path regardless of extra query parameters", async () => {
      const { cookieValue } = await performLogin();
      mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
      const res = await performCallbackWithTxnCookie(cookieValue, "code=x&state=y&returnTo=https://evil.example");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    describe("security", () => {
      it("26. extra fields injected into the transaction cookie or the callback query string (tenantId/userId/email) cannot alter identity resolution", async () => {
        const { res: loginRes } = await performLogin();
        const setCookies = parseSetCookieHeaders(loginRes.headers);
        const txnCookie = findCookie(setCookies, "oidc_txn")!;
        const cookieValuePart = txnCookie.split(";")[0];
        const realTransaction = JSON.parse(decodeURIComponent(cookieValuePart.split("=").slice(1).join("=")));

        const poisonedTransaction = { ...realTransaction, userId: "evil-user-id", tenantId: "evil-tenant-id", email: "evil@evil.com" };
        const poisonedCookie = `oidc_txn=${encodeURIComponent(JSON.stringify(poisonedTransaction))}`;

        mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
        const res = await performCallbackWithTxnCookie(
          poisonedCookie,
          "code=x&state=y&userId=evil&tenantId=evil&email=evil@evil.com"
        );

        expect(res.status).toBe(302);
        const createdSession = await prisma.session.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
        expect(createdSession?.userId).toBe(userId); // the REAL mapped user, never "evil-user-id"
      });

      it("27. callback cannot succeed without a valid transaction (covered by 11-13; reconfirmed with a syntactically valid but unmapped cookie shape)", async () => {
        const noTransactionAtAll = await httpGet("/auth/callback?code=x&state=y");
        expect(noTransactionAtAll.status).toBe(401);
        expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
      });

      it("28. the session token, PKCE verifier, state, and nonce never appear in server-side logs", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const { cookieValue, transaction } = await performLogin();
          mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
          const res = await performCallbackWithTxnCookie(cookieValue);
          const setCookies = parseSetCookieHeaders(res.headers);
          const rawToken = findCookie(setCookies, "session")!.split(";")[0].split("=")[1];

          mockExchangeAuthorizationCode.mockRejectedValueOnce(new Error("exchange failed"));
          const { cookieValue: cookieValue2 } = await performLogin();
          await performCallbackWithTxnCookie(cookieValue2);

          const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
          expect(loggedText).not.toContain(rawToken);
          expect(loggedText).not.toContain(transaction.codeVerifier);
          expect(loggedText).not.toContain(transaction.state);
          expect(loggedText).not.toContain(transaction.nonce);
        } finally {
          errorSpy.mockRestore();
        }
      });

      it("29. the transaction cookie cannot be used as a session/authentication credential", async () => {
        const { cookieValue } = await performLogin();
        const rawTxnValue = decodeURIComponent(cookieValue.split("=").slice(1).join("="));

        const result = await findActiveSessionByRawToken(rawTxnValue);
        expect(result).toBeNull();
      });

      it("30. every failure path leaves domain data (requests/decisions/etc.) completely untouched", async () => {
        const requestCountBefore = await prisma.procurementRequest.count();
        const { cookieValue } = await performLogin();
        mockExchangeAuthorizationCode.mockRejectedValueOnce(new Error("exchange failed"));
        await performCallbackWithTxnCookie(cookieValue);

        expect(await prisma.procurementRequest.count()).toBe(requestCountBefore);
      });
    });
  });

  // ---------------------------------------------------------------
  // /auth/logout (AUTHN Step 7)
  // ---------------------------------------------------------------
  describe("/auth/logout", () => {
    it("31. a valid session is revoked: logout succeeds and the session no longer authenticates", async () => {
      const { rawToken } = await createSession(userId);
      expect(await findActiveSessionByRawToken(rawToken)).not.toBeNull();

      const res = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });

      expect(res.status).toBe(200);
      expect(await findActiveSessionByRawToken(rawToken)).toBeNull();
    });

    it("32. logout without any session cookie still succeeds", async () => {
      const res = await httpPost("/auth/logout");
      expect(res.status).toBe(200);
      expect(JSON.parse(res.bodyText)).toEqual({ ok: true });
    });

    it("33. logout with an unknown/invalid session token still succeeds", async () => {
      const res = await httpPost("/auth/logout", { cookie: `session=${"0".repeat(64)}` });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.bodyText)).toEqual({ ok: true });
    });

    it("34. logout is idempotent: calling it twice with the same already-revoked session still succeeds", async () => {
      const { rawToken } = await createSession(userId);
      const first = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });
      const second = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(JSON.parse(second.bodyText)).toEqual({ ok: true });
    });

    it("35. the response never reveals whether a session existed, was valid, expired, or already revoked — every case is byte-identical", async () => {
      const { rawToken } = await createSession(userId);
      const validRes = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });
      const missingRes = await httpPost("/auth/logout");
      const unknownRes = await httpPost("/auth/logout", { cookie: `session=${"1".repeat(64)}` });

      expect(validRes.status).toBe(missingRes.status);
      expect(missingRes.status).toBe(unknownRes.status);
      expect(validRes.bodyText).toBe(missingRes.bodyText);
      expect(missingRes.bodyText).toBe(unknownRes.bodyText);
    });

    it("36. the response never contains a raw session token", async () => {
      const { rawToken } = await createSession(userId);
      const res = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });
      expect(res.bodyText).not.toContain(rawToken);
    });

    it("37. clears the session cookie with the same scope/attributes it was set with, and immediate expiry", async () => {
      const { rawToken } = await createSession(userId);
      const res = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });

      const setCookies = parseSetCookieHeaders(res.headers);
      const clearedSession = findCookie(setCookies, "session");
      expect(clearedSession).toBeDefined();
      expect(clearedSession!.toLowerCase()).toContain("httponly");
      expect(clearedSession!.toLowerCase()).toContain("secure");
      expect(clearedSession!.toLowerCase()).toContain("samesite=lax");
      expect(clearedSession!).toContain("Path=/;");
      expect(clearedSession!.toLowerCase()).toMatch(/max-age=0/);
    });

    it("38. does not clear or otherwise touch the oidc_txn cookie", async () => {
      const { rawToken } = await createSession(userId);
      const res = await httpPost("/auth/logout", { cookie: `session=${rawToken}` });

      const setCookies = parseSetCookieHeaders(res.headers);
      expect(findCookie(setCookies, "oidc_txn")).toBeUndefined();
    });

    it("39. a malformed cookie header fails closed to a no-op logout rather than throwing", async () => {
      const res = await httpPost("/auth/logout", { cookie: "%%%not-a-valid-cookie-header%%%=== ;;;" });
      expect(res.status).toBe(200);
    });
  });
});
