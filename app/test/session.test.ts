import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "../src/db/client";
import { createSession, findActiveSessionByRawToken, revokeSessionByRawToken } from "../src/api/session";

// Session infrastructure tests (AUTHN-4, Step 3). Real PostgreSQL, per
// this repository's existing convention (workflow.e2e.test.ts,
// adversarial.test.ts) — session persistence behavior is proved against
// the real datastore, not a mock. This file owns a dedicated Tenant/User
// fixture pair and cleans up everything it creates in afterAll, since
// unlike the existing suites it would otherwise leave Session rows behind
// with no other test ever touching this table.

describe("Session infrastructure", () => {
  let tenantId: string;
  let userId: string;
  let otherUserId: string;
  const createdTokenHashes: string[] = [];

  function trackHash(rawToken: string) {
    createdTokenHashes.push(createHash("sha256").update(rawToken).digest("hex"));
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Session Test Tenant" } });
    tenantId = tenant.id;
    userId = (await prisma.user.create({ data: { tenantId, name: "Session Test User", role: "procurement_user" } })).id;
    otherUserId = (await prisma.user.create({ data: { tenantId, name: "Session Test User 2", role: "procurement_user" } })).id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { tokenHash: { in: createdTokenHashes } } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  describe("raw token generation", () => {
    it("generated raw tokens are non-empty, fixed-length hex, and sufficiently high entropy (unique across many calls)", async () => {
      const sessions = await Promise.all(Array.from({ length: 50 }, () => createSession(userId)));
      for (const s of sessions) trackHash(s.rawToken);

      const tokens = sessions.map((s) => s.rawToken);
      for (const token of tokens) {
        expect(typeof token).toBe("string");
        expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes, hex-encoded
      }
      expect(new Set(tokens).size).toBe(tokens.length); // all unique
    });
  });

  describe("createSession", () => {
    it("stores the correct userId, sets createdAt/lastSeenAt via Prisma defaults, and sets ~14-day absolute expiry", async () => {
      const before = Date.now();
      const { rawToken, expiresAt } = await createSession(userId);
      trackHash(rawToken);
      const after = Date.now();

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });

      expect(row.userId).toBe(userId);
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(after + 1000);
      expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const expectedExpiry = before + fourteenDaysMs;
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 5000);
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 5000);
      expect(expiresAt.getTime()).toBe(row.expiresAt.getTime());
    });

    it("persists only the SHA-256 hash in Session.tokenHash — the raw token never appears in the stored row", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });

      expect(row.tokenHash).not.toBe(rawToken);
      expect(row.tokenHash).toBe(tokenHash);
      expect(JSON.stringify(row)).not.toContain(rawToken);
    });

    it("does not return the database row as an API object — only { rawToken, expiresAt }", async () => {
      const created = await createSession(userId);
      trackHash(created.rawToken);

      expect(Object.keys(created).sort()).toEqual(["expiresAt", "rawToken"]);
      expect(created).not.toHaveProperty("tokenHash");
      expect(created).not.toHaveProperty("userId");
    });
  });

  describe("findActiveSessionByRawToken", () => {
    it("a valid, unexpired session resolves to its userId", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);

      const result = await findActiveSessionByRawToken(rawToken);
      expect(result).toEqual({ userId });
    });

    it("returns null for a raw token that was never issued", async () => {
      const result = await findActiveSessionByRawToken("0".repeat(64));
      expect(result).toBeNull();
    });

    it("returns null for an expired session, without extending its expiresAt", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      const alreadyExpired = new Date(Date.now() - 1000);
      await prisma.session.update({ where: { tokenHash }, data: { expiresAt: alreadyExpired } });

      const result = await findActiveSessionByRawToken(rawToken);
      expect(result).toBeNull();

      const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      expect(row.expiresAt.getTime()).toBe(alreadyExpired.getTime());
    });

    it("looking up the same raw token repeatedly resolves consistently (deterministic hashing)", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);

      const first = await findActiveSessionByRawToken(rawToken);
      const second = await findActiveSessionByRawToken(rawToken);
      expect(first).toEqual({ userId });
      expect(second).toEqual({ userId });
    });

    it("updates lastSeenAt on a successful lookup, without changing expiresAt", async () => {
      const { rawToken, expiresAt } = await createSession(userId);
      trackHash(rawToken);
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const before = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await findActiveSessionByRawToken(rawToken);

      const after = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
      expect(after.expiresAt.getTime()).toBe(expiresAt.getTime());
    });

    it("different raw tokens never resolve to each other's sessions", async () => {
      const a = await createSession(userId);
      const b = await createSession(otherUserId);
      trackHash(a.rawToken);
      trackHash(b.rawToken);

      expect(await findActiveSessionByRawToken(a.rawToken)).toEqual({ userId });
      expect(await findActiveSessionByRawToken(b.rawToken)).toEqual({ userId: otherUserId });
    });
  });

  describe("revokeSessionByRawToken", () => {
    it("revokes a session so it can no longer be looked up", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);

      await revokeSessionByRawToken(rawToken);

      expect(await findActiveSessionByRawToken(rawToken)).toBeNull();
    });

    it("is idempotent — revoking an already-revoked or nonexistent session does not throw", async () => {
      const { rawToken } = await createSession(userId);
      trackHash(rawToken);

      await revokeSessionByRawToken(rawToken);
      await expect(revokeSessionByRawToken(rawToken)).resolves.toBeUndefined();
      await expect(revokeSessionByRawToken("f".repeat(64))).resolves.toBeUndefined();
    });
  });
});
