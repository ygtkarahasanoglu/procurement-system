import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Request } from "express";
import { prisma } from "../src/db/client";
import { createSession } from "../src/api/session";
import { sessionAuthenticator } from "../src/api/sessionAuthenticator";

// Unit tests for the session-backed Authenticator (AUTHN Step 6A). Real
// PostgreSQL, per this repository's existing convention — session/User
// resolution is proved against the real datastore. Only the
// "User cannot be resolved" case is stubbed (see that test for why).

function fakeRequest(cookieHeader: string | undefined): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

describe("sessionAuthenticator", () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "SessionAuthenticator Test Tenant" } });
    tenantId = tenant.id;
    userId = (
      await prisma.user.create({ data: { tenantId, name: "SessionAuthenticator Test User", role: "procurement_user" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it("a valid session resolves to the exact Principal { userId, tenantId }", async () => {
    const { rawToken } = await createSession(userId);
    const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
    expect(principal).toEqual({ userId, tenantId });
  });

  it("a missing cookie header returns null", async () => {
    const principal = await sessionAuthenticator(fakeRequest(undefined));
    expect(principal).toBeNull();
  });

  it("a missing 'session' cookie (other cookies present) returns null", async () => {
    const principal = await sessionAuthenticator(fakeRequest("oidc_txn=something-else"));
    expect(principal).toBeNull();
  });

  it("a malformed cookie header returns null rather than throwing", async () => {
    // A header value cookie parsers are not guaranteed to make sense of —
    // this must fail closed, not throw.
    const principal = await sessionAuthenticator(fakeRequest("%%%not-a-valid-cookie-header%%%=== ;;;"));
    expect(principal).toBeNull();
  });

  it("an unknown session token returns null", async () => {
    const principal = await sessionAuthenticator(fakeRequest(`session=${"0".repeat(64)}`));
    expect(principal).toBeNull();
  });

  it("an expired session returns null", async () => {
    const { rawToken } = await createSession(userId);
    const tokenHash = await import("node:crypto").then((c) => c.createHash("sha256").update(rawToken).digest("hex"));
    await prisma.session.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
    expect(principal).toBeNull();
  });

  it("a session whose User cannot be resolved fails closed (never manufactures a Principal)", async () => {
    // Session.userId has an FK (ON DELETE RESTRICT) to User, so a genuinely
    // dangling reference cannot exist in real Postgres — the same situation
    // already encountered in externalIdentity.test.ts. The same minimal
    // direct-property-stub technique is used here, for the same reason
    // (Prisma 6's Proxy-based client delegates do not survive
    // vi.spyOn/mockRestore reliably), rather than redesigning persistence.
    const { rawToken } = await createSession(userId);

    const originalFindUnique = prisma.user.findUnique;
    prisma.user.findUnique = (async () => null) as unknown as typeof prisma.user.findUnique;
    try {
      const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
      expect(principal).toBeNull();
    } finally {
      prisma.user.findUnique = originalFindUnique;
    }
  });

  it("tenantId always comes from User.tenantId, never from anywhere else", async () => {
    const { rawToken } = await createSession(userId);
    const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(principal?.tenantId).toBe(userRow.tenantId);
  });

  it("the raw cookie token is never interpreted as a userId (it is hashed and looked up, not parsed as an id)", async () => {
    const { rawToken } = await createSession(userId);
    const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
    expect(principal?.userId).not.toBe(rawToken);
    expect(principal?.userId).toBe(userId);
  });

  it("no email or OIDC identity is ever involved in session resolution", async () => {
    const { rawToken } = await createSession(userId);
    const principal = await sessionAuthenticator(fakeRequest(`session=${rawToken}`));
    expect(principal).toEqual({ userId, tenantId }); // exactly these two fields — nothing else
    expect(Object.keys(principal!).sort()).toEqual(["tenantId", "userId"]);
  });
});
