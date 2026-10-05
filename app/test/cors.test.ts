import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";
import { createApp } from "../src/api/server";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";

// AUTHN-11 (CORS Restriction Requirement, docs/decisions/ratified.md):
// focused, header-level proof that the real createApp(...) composition
// now enforces an exact trusted-origin allow-list (read from
// CORS_TRUSTED_ORIGINS) instead of the previous wildcard `cors()`
// default. Uses the same real createServer(createApp(...)) + raw fetch
// style as authIntegration.test.ts, because these assertions are about
// response HEADERS, which the JSON-only httpGet/httpPost helpers in
// adversarial.test.ts deliberately discard.
//
// These tests exercise the CORS layer, which runs as the very first
// middleware in server.ts — before the authentication middleware and
// before any route handler. The eventual status code of a non-preflight
// request is therefore not the property under test (A-D); only the
// Access-Control-* response headers are. Group E/H are the exceptions,
// proving the CORS change leaves existing authentication/tenant behavior
// (including the 401 for no-session requests) completely unaffected.

const TRUSTED_ORIGIN = "https://trusted.cors-test.example";
const UNTRUSTED_ORIGIN = "https://untrusted.cors-test.example";

let httpServer: Server;
let baseUrl: string;

async function rawRequest(path: string, init: { method: string; origin?: string; headers?: Record<string, string> }) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.origin) headers.Origin = init.origin;
  return fetch(`${baseUrl}${path}`, { method: init.method, headers });
}

describe("AUTHN-11 — CORS trusted-origin allow-list", () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    // Set BEFORE createApp() runs: server.ts reads CORS_TRUSTED_ORIGINS
    // once per createApp() call, exactly like the existing OIDC env-config
    // pattern (loadOidcConfigFromEnv) reads its own vars per call/request —
    // never cached at module-import time.
    process.env.CORS_TRUSTED_ORIGINS = TRUSTED_ORIGIN;

    await new Promise<void>((resolve) => {
      httpServer = createServer(createApp(testAuthenticator));
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "CORS Test Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "CORS Test User", role: "procurement_user" } })).id;
  });

  afterAll(async () => {
    httpServer.close();
    delete process.env.CORS_TRUSTED_ORIGINS;
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it("A. a trusted Origin receives exactly its own value in Access-Control-Allow-Origin", async () => {
    const res = await rawRequest("/tenants", { method: "GET", origin: TRUSTED_ORIGIN });
    expect(res.headers.get("access-control-allow-origin")).toBe(TRUSTED_ORIGIN);
  });

  it("B. a trusted Origin receives Access-Control-Allow-Credentials: true", async () => {
    const res = await rawRequest("/tenants", { method: "GET", origin: TRUSTED_ORIGIN });
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("C. an untrusted Origin receives no Access-Control-Allow-Origin at all", async () => {
    const res = await rawRequest("/tenants", { method: "GET", origin: UNTRUSTED_ORIGIN });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("D. an untrusted Origin is never reflected, and receives no Access-Control-Allow-Credentials either", async () => {
    const res = await rawRequest("/tenants", { method: "GET", origin: UNTRUSTED_ORIGIN });
    expect(res.headers.get("access-control-allow-origin")).not.toBe(UNTRUSTED_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("E. a request with no Origin header at all is unaffected — the existing authentication boundary alone decides the outcome", async () => {
    const res = await rawRequest("/tenants", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("F. an allowed preflight (OPTIONS) receives the exact origin and credentials, short-circuited with 204 before any route/auth logic", async () => {
    const res = await rawRequest("/tenants", {
      method: "OPTIONS",
      origin: TRUSTED_ORIGIN,
      headers: { "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(TRUSTED_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.status).toBe(204);
  });

  it("G. a disallowed preflight (OPTIONS) is not permissive — no Access-Control-Allow-Origin, and not short-circuited as a successful preflight", async () => {
    const res = await rawRequest("/tenants", {
      method: "OPTIONS",
      origin: UNTRUSTED_ORIGIN,
      headers: { "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.status).not.toBe(204);
  });

  it("H. existing authentication/tenant behavior is unaffected — a legitimate authenticated request still succeeds exactly as before", async () => {
    const res = await rawRequest("/tenants", {
      method: "GET",
      headers: { [TEST_USER_ID_HEADER]: userId, [TEST_TENANT_ID_HEADER]: tenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((t) => t.id)).toEqual([tenantId]);
  });
});
