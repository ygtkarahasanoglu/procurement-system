import { describe, expect, it } from "vitest";
import { assertTenantMatches } from "../src/api/tenantBinding";
import { TenantMismatchError } from "../src/domain/errors";
import type { Principal } from "../src/api/principal";

// Pure, DB-free unit tests for the AUTH-1/AUTH-2 tenant-binding helper.
// This file is intentionally isolated from workflow.e2e.test.ts and
// adversarial.test.ts: assertTenantMatches has no database dependency, so
// these tests need none of the shared tenant/user fixtures those files set
// up, and this helper is not wired into any route yet.

describe("assertTenantMatches (AUTH-1/AUTH-2 tenant-binding helper)", () => {
  it("returns the tenantId when it matches the principal's tenantId", () => {
    const principal: Principal = { userId: "user-1", tenantId: "tenant-1" };
    expect(assertTenantMatches(principal, "tenant-1")).toBe("tenant-1");
  });

  it("throws TenantMismatchError when the claimed tenantId differs from the principal's", () => {
    const principal: Principal = { userId: "user-1", tenantId: "tenant-1" };
    expect(() => assertTenantMatches(principal, "tenant-2")).toThrow(TenantMismatchError);
  });
});
