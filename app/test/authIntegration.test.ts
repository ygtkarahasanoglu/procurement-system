import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";

// Integration proof for AUTHN Step 6A: the REAL createApp(sessionAuthenticator)
// composition root — not a test double, not the standalone router from
// authRoutes.test.ts in isolation. Only the external OIDC network boundary
// (oidc.ts) is mocked, exactly as already done in authRoutes.test.ts.
//
// This is the one proof that did not exist before Step 6A: that a session
// cookie minted by a real /auth/callback request actually authenticates a
// SEPARATE, LATER request through the production Authenticator wired into
// the production createApp — and that the /auth carve-out is exactly two
// routes wide, never broader.

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

import { createApp } from "../src/api/server";
import { sessionAuthenticator } from "../src/api/sessionAuthenticator";

let httpServer: Server;
let baseUrl: string;

async function httpGet(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { method: "GET", headers, redirect: "manual" });
  const bodyText = await res.text().catch(() => "");
  return { status: res.status, headers: res.headers, bodyText };
}

function parseSetCookieHeaders(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") return maybeGetSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function findCookie(setCookieHeaders: string[], name: string): string | undefined {
  return setCookieHeaders.find((c) => c.startsWith(`${name}=`));
}

const ISSUER = "https://oidc-provider.example";
const KNOWN_SUBJECT = "verified-subject-integration-001";
const VALID_ENV = {
  OIDC_ISSUER_URL: ISSUER,
  OIDC_CLIENT_ID: "test-client-id",
  OIDC_CLIENT_SECRET: "test-client-secret",
  OIDC_REDIRECT_URI: "https://app.example/auth/callback",
};

describe("AUTHN Step 6A — real createApp(sessionAuthenticator) integration", () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const app = createApp(sessionAuthenticator);
    await new Promise<void>((resolve) => {
      httpServer = createServer(app);
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "AuthIntegration Test Tenant" } });
    tenantId = tenant.id;
    userId = (
      await prisma.user.create({ data: { tenantId, name: "AuthIntegration Test User", role: "procurement_user" } })
    ).id;
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
    Object.assign(process.env, VALID_ENV);
    mockDiscoverProvider.mockReset().mockResolvedValue({});
    mockBuildAuthorizationRequest.mockReset().mockImplementation(async () => ({
      url: new URL("https://oidc-provider.example/authorize?mock=login"),
      state: "s",
      nonce: "n",
      codeVerifier: "v",
    }));
    mockExchangeAuthorizationCode.mockReset();
  });

  it("A. /auth/login is reachable without a session (not rejected by the blanket authentication middleware)", async () => {
    const res = await httpGet("/auth/login");
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(302);
  });

  it("B. /auth/callback is reachable without a session — it reaches the auth router's own logic, not the blanket middleware", async () => {
    const res = await httpGet("/auth/callback?code=x&state=y");
    expect(res.status).toBe(401);
    // Distinguishes "reached authRoutes.ts's own generic failure" from the
    // blanket middleware's "Unauthenticated" — if the blanket middleware had
    // intercepted this request, the error would be "Unauthenticated", not
    // "AuthenticationFailed".
    expect(JSON.parse(res.bodyText)).toMatchObject({ error: "AuthenticationFailed" });
  });

  it("C. full round trip: login -> callback (known identity) -> session cookie authenticates a separate, later request", async () => {
    const loginRes = await httpGet("/auth/login");
    const loginCookies = parseSetCookieHeaders(loginRes.headers);
    const txnCookie = findCookie(loginCookies, "oidc_txn")!.split(";")[0];

    mockExchangeAuthorizationCode.mockResolvedValueOnce({ issuer: ISSUER, subject: KNOWN_SUBJECT });
    const callbackRes = await httpGet("/auth/callback?code=mockcode&state=mockstate", { cookie: txnCookie });
    expect(callbackRes.status).toBe(302);

    const callbackCookies = parseSetCookieHeaders(callbackRes.headers);
    const sessionCookie = findCookie(callbackCookies, "session")!.split(";")[0];

    // Second, separate HTTP request against an existing protected route,
    // using only the session cookie captured above.
    const protectedRes = await httpGet(`/tenants/${tenantId}/context`, { cookie: sessionCookie });
    expect(protectedRes.status).toBe(200);
    const body = JSON.parse(protectedRes.bodyText);
    expect(body).toHaveProperty("users");
  });

  it("D. the same protected route without a session returns 401 (existing behavior unchanged)", async () => {
    const res = await httpGet(`/tenants/${tenantId}/context`);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.bodyText)).toMatchObject({ error: "Unauthenticated" });
  });

  it("E. the Principal is derived only from the session/User chain — an arbitrary request-supplied identity header has no effect", async () => {
    // x-test-user-id / x-test-tenant-id are the headers the test-only
    // authenticator (app/test/support/testAuthenticator.ts) reads. The
    // production sessionAuthenticator must never consult them.
    const res = await httpGet(`/tenants/${tenantId}/context`, {
      "x-test-user-id": userId,
      "x-test-tenant-id": tenantId,
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.bodyText)).toMatchObject({ error: "Unauthenticated" });
  });

  it("F. the /auth carve-out is limited to /auth and does not make an unrelated route unauthenticated", async () => {
    const res = await httpGet("/tenants");
    expect(res.status).toBe(401);
    expect(JSON.parse(res.bodyText)).toMatchObject({ error: "Unauthenticated" });
  });
});
