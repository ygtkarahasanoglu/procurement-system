import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateRawToken, hashToken } from "../src/api/rfqResponseToken";

// RFQ Batch 3 — pure crypto primitives only. No database, no tenant
// context; see rfqDispatchService.test.ts for the issuance/persistence
// behavior built on top of these.
describe("rfqResponseToken (pure crypto primitives)", () => {
  it("generateRawToken produces 64 lowercase hex characters (256-bit entropy)", () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two calls to generateRawToken produce different tokens", () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });

  it("hashToken is deterministic for the same input", () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("hashToken produces different hashes for different inputs", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });

  it("hashToken produces 64 lowercase hex characters (SHA-256)", () => {
    expect(hashToken(generateRawToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------------------------------------------------------------
  // Module boundary — this must remain a pure, dependency-free module.
  // ---------------------------------------------------------------
  it("contains no Prisma/tenantScoped import and no RFQ business logic", async () => {
    const source = await readFile(join(__dirname, "../src/api/rfqResponseToken.ts"), "utf-8");
    const importLines = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/prisma/i);
    expect(importLines).not.toMatch(/tenantScoped/);
    expect(source).not.toMatch(/db\.rFQDispatch|prisma\.rFQDispatch/);
  });
});
