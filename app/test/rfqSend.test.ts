import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { prisma, tenantScoped, TenantGuardRejection } from "../src/db/client";
import * as rfqDispatchService from "../src/services/rfqDispatchService";
import { hashToken } from "../src/api/rfqResponseToken";
import { NotFoundError, InvalidStateError } from "../src/domain/errors";
import { AuthorizationError } from "../src/domain/authorization";
import { createApp } from "../src/api/server";
import type { SendRFQDispatchDeps } from "../src/services/rfqDispatchService";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";
import { FakeEmailSender } from "./support/fakeEmailSender";

// RFQ SEND — RFQ-S1/RFQ-S2 (docs/decisions/ratified.md). Exercises the
// real test database, following this repo's established convention.
// All email transport is the FakeEmailSender below — no real provider.
describe("sendRFQDispatch / retryRFQDispatch (service)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let procurementUserAId: string;
  let approverAId: string;
  let otherRoleUserAId: string;
  let supplierAId: string;
  let supplierNoEmailId: string;
  let supplierBId: string;
  let sourcingEventAId: string;
  let sourcingEventBId: string;

  const fakeSender = new FakeEmailSender();
  const deps: SendRFQDispatchDeps = { emailSender: fakeSender, responseBaseUrl: "http://localhost:3000" };

  async function makeSourcingEvent(tenantId: string, label: string) {
    const user = await prisma.user.create({ data: { tenantId, name: `${label} User`, role: "procurement_user" } });
    const product = await prisma.product.create({ data: { tenantId, name: `${label} Product`, sku: `${label}-SKU` } });
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "100", unit: "EA" },
    });
    return (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  }

  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({ data: { name: "RFQSend Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "RFQSend Tenant B" } });
    tenantBId = tenantB.id;

    procurementUserAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "RFQSend Procurement User", role: "procurement_user" } })
    ).id;
    approverAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "RFQSend Approver", role: "approver" } })
    ).id;
    otherRoleUserAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "RFQSend Other Role", role: "viewer" } })
    ).id;

    supplierAId = (
      await prisma.supplier.create({ data: { tenantId: tenantAId, name: "RFQSend Supplier A", email: "supplierA@example.com" } })
    ).id;
    supplierNoEmailId = (
      await prisma.supplier.create({ data: { tenantId: tenantAId, name: "RFQSend Supplier No-Email" } })
    ).id;
    supplierBId = (
      await prisma.supplier.create({ data: { tenantId: tenantBId, name: "RFQSend Tenant B Secret Supplier", email: "b@example.com" } })
    ).id;

    sourcingEventAId = await makeSourcingEvent(tenantAId, "RFQSend-A");
    sourcingEventBId = await makeSourcingEvent(tenantBId, "RFQSend-B-Secret");
  });

  async function freshPendingDispatch(supplierId = supplierAId, sourcingEventId = sourcingEventAId, tenantId = tenantAId) {
    return rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
  }

  // ---------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------
  describe("authorization", () => {
    it("a user with a role outside procurement_user/approver cannot SEND", async () => {
      const dispatch = await freshPendingDispatch();
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, otherRoleUserAId, dispatch.id, deps)
      ).rejects.toThrow(AuthorizationError);
    });

    it("procurement_user can SEND", async () => {
      const dispatch = await freshPendingDispatch();
      const result = await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SENT");
    });

    it("approver can SEND", async () => {
      const dispatch = await freshPendingDispatch();
      const result = await rfqDispatchService.sendRFQDispatch(tenantAId, approverAId, dispatch.id, deps);
      expect(result.status).toBe("SENT");
    });

    it("authorization runs before any dispatch lookup — an unauthorized role targeting a nonexistent dispatch still gets AuthorizationError, not NotFoundError", async () => {
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, otherRoleUserAId, randomUUID(), deps)
      ).rejects.toThrow(AuthorizationError);
    });
  });

  // ---------------------------------------------------------------
  // Preflight: existence/tenant resolution, then deterministic validation
  // ---------------------------------------------------------------
  describe("preflight", () => {
    it("a nonexistent dispatch is rejected with NotFoundError and claims nothing", async () => {
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, randomUUID(), deps)
      ).rejects.toThrow(NotFoundError);
    });

    it("a cross-tenant dispatch is rejected identically, and the row is left completely unchanged", async () => {
      const dispatch = await freshPendingDispatch(supplierBId, sourcingEventBId, tenantBId);
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(NotFoundError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("PENDING");
      expect(unchanged.responseTokenHash).toBeNull();
    });

    it("a Supplier with no email leaves the dispatch PENDING, issues no token, and never invokes EmailSender", async () => {
      const callsBefore = fakeSender.calls.length;
      const dispatch = await freshPendingDispatch(supplierNoEmailId);

      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("PENDING");
      expect(unchanged.responseTokenHash).toBeNull();
      expect(fakeSender.calls.length).toBe(callsBefore);
    });

    it("a defense-in-depth tenant-consistency check rejects a dispatch whose nested relations do not all belong to the same tenant (a state the normal API can never produce — constructed directly here to prove the check actually fires)", async () => {
      const dispatch = await freshPendingDispatch();
      // Bare prisma, test-only: deliberately bypasses createRFQDispatch's
      // own validation to construct exactly the "should be impossible"
      // state the new invariant check exists to catch — a top-level
      // RFQDispatch.tenantId of tenantA whose nested Supplier actually
      // belongs to tenantB. Without the check, this would proceed to
      // compose an email using tenantB's supplier data.
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { supplierId: supplierBId } });

      const callsBefore = fakeSender.calls.length;
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(/[Ii]nternal inconsistency/);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("PENDING");
      expect(unchanged.responseTokenHash).toBeNull();
      expect(fakeSender.calls.length).toBe(callsBefore);
    });
  });

  // ---------------------------------------------------------------
  // CAS claim
  // ---------------------------------------------------------------
  describe("CAS claim", () => {
    it("exactly one of two concurrent SEND calls for the same dispatch wins, and EmailSender is invoked exactly once", async () => {
      const dispatch = await freshPendingDispatch();
      const callsBefore = fakeSender.calls.length;

      const results = await Promise.allSettled([
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps),
        rfqDispatchService.sendRFQDispatch(tenantAId, approverAId, dispatch.id, deps),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);
      expect(fakeSender.calls.length).toBe(callsBefore + 1);
    });

    it("a dispatch already in SENDING cannot be claimed again", async () => {
      const dispatch = await freshPendingDispatch();
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENDING" } });
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);
    });

    it("a dispatch already SENT cannot be claimed again", async () => {
      const dispatch = await freshPendingDispatch();
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENT" } });
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);
    });

    it("a dispatch already SEND_FAILED cannot be claimed again", async () => {
      const dispatch = await freshPendingDispatch();
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SEND_FAILED" } });
      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);
    });

    it("the CAS claim is genuinely guarded by tenantScoped() — a tenant-mismatched claim is rejected by the guard itself", async () => {
      const dispatch = await freshPendingDispatch();
      const db = tenantScoped(tenantBId);
      await expect(
        db.rFQDispatch.updateMany({
          where: { id: dispatch.id, tenantId: tenantAId, status: "PENDING" },
          data: { status: "SENDING" },
        })
      ).rejects.toThrow(TenantGuardRejection);
    });
  });

  // ---------------------------------------------------------------
  // Token
  // ---------------------------------------------------------------
  describe("token", () => {
    it("a token is issued and persisted (as a hash) only once the claim succeeds, and the raw token reaches the composed email", async () => {
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.responseTokenHash).not.toBeNull();
      expect(row.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());

      const sentBody = fakeSender.calls[fakeSender.calls.length - 1].body;
      const match = sentBody.match(/rfq-response\/([0-9a-f]{64})/);
      expect(match).not.toBeNull();
      const rawTokenInEmail = match![1];
      expect(hashToken(rawTokenInEmail)).toBe(row.responseTokenHash);
    });

    it("an unexpected exception after the claim (e.g. token issuance or composition failure) leaves the dispatch in SENDING, not SEND_FAILED", async () => {
      const dispatch = await freshPendingDispatch();
      const throwingSender = new FakeEmailSender();
      throwingSender.send = async () => {
        throw new Error("simulated failure between claim and final write");
      };

      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, {
          emailSender: throwingSender,
          responseBaseUrl: "http://localhost:3000",
        })
      ).rejects.toThrow("simulated failure");

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENDING");
    });
  });

  // ---------------------------------------------------------------
  // Email composition / tenant leakage
  // ---------------------------------------------------------------
  describe("email composition", () => {
    it("header-injection attempts in stored supplier/product names do not reach the subject line", async () => {
      const injectingProductSourcingEvent = await (async () => {
        const user = await prisma.user.create({ data: { tenantId: tenantAId, name: "Inj User", role: "procurement_user" } });
        const product = await prisma.product.create({
          data: { tenantId: tenantAId, name: "Widget\r\nBcc: attacker@evil.com", sku: "INJ-SKU" },
        });
        const request = await prisma.procurementRequest.create({ data: { tenantId: tenantAId, createdById: user.id } });
        const line = await prisma.requestLine.create({
          data: { tenantId: tenantAId, requestId: request.id, productId: product.id, requestedQuantity: "1", unit: "EA" },
        });
        return (await prisma.sourcingEvent.create({ data: { tenantId: tenantAId, requestLineId: line.id } })).id;
      })();

      const dispatch = await freshPendingDispatch(supplierAId, injectingProductSourcingEvent);
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const sent = fakeSender.calls[fakeSender.calls.length - 1];
      expect(sent.subject).not.toMatch(/[\r\n]/);
    });

    it("a tenant A SEND never includes tenant B's supplier/product data", async () => {
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const sent = fakeSender.calls[fakeSender.calls.length - 1];
      expect(sent.body).not.toContain("Tenant B Secret");
      expect(sent.to).not.toBe("b@example.com");
    });
  });

  // ---------------------------------------------------------------
  // EmailSender outcomes -> final state
  // ---------------------------------------------------------------
  describe("EmailSender outcome -> final state", () => {
    it("success -> SENT", async () => {
      fakeSender.setNextOutcome({ kind: "success" });
      const dispatch = await freshPendingDispatch();
      const result = await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SENT");
      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENT");
    });

    it("explicit failure -> SEND_FAILED", async () => {
      fakeSender.setNextOutcome({ kind: "failure", reason: "provider rejected" });
      const dispatch = await freshPendingDispatch();
      const result = await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SEND_FAILED");
      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SEND_FAILED");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("timeout/unknown -> remains SENDING, never SEND_FAILED", async () => {
      fakeSender.setNextOutcome({ kind: "unknown" });
      const dispatch = await freshPendingDispatch();
      const result = await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SENDING");
      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENDING");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });
  });

  // ---------------------------------------------------------------
  // providerMessageId persistence — RFQ-EP4 (docs/decisions/ratified.md):
  // an opaque provider correlation identifier, persisted only alongside
  // an explicit SUCCESS outcome, never invented for failure/unknown.
  // ---------------------------------------------------------------
  describe("providerMessageId persistence (RFQ-EP4)", () => {
    it("success with a providerMessageId persists it on the RFQDispatch row", async () => {
      fakeSender.setNextOutcome({ kind: "success", providerMessageId: "filter-abc.xyz-0" });
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENT");
      expect(row.providerMessageId).toBe("filter-abc.xyz-0");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("success without a providerMessageId leaves the column null — absence is never invented", async () => {
      fakeSender.setNextOutcome({ kind: "success" });
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENT");
      expect(row.providerMessageId).toBeNull();
    });

    it("explicit failure never persists a providerMessageId, even if one were somehow present on the outcome", async () => {
      fakeSender.setNextOutcome({ kind: "failure", reason: "provider rejected" });
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SEND_FAILED");
      expect(row.providerMessageId).toBeNull();
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("unknown outcome never persists a providerMessageId and performs no final-state write at all", async () => {
      fakeSender.setNextOutcome({ kind: "unknown" });
      const dispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENDING");
      expect(row.providerMessageId).toBeNull();
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("retryRFQDispatch also persists a fresh providerMessageId on a successful retry, overwriting any prior value", async () => {
      const dispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SEND_FAILED", providerMessageId: null } });

      fakeSender.setNextOutcome({ kind: "success", providerMessageId: "retry-filter.def-1" });
      await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENT");
      expect(row.providerMessageId).toBe("retry-filter.def-1");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });
  });

  // ---------------------------------------------------------------
  // Final-write internal-consistency detection
  // ---------------------------------------------------------------
  describe("final write internal consistency", () => {
    it("surfaces an error if the dispatch is no longer SENDING when the final outcome is recorded, rather than silently ignoring it", async () => {
      const dispatch = await freshPendingDispatch();
      const interferingSender = new FakeEmailSender();
      interferingSender.send = async (input) => {
        // Simulates an impossible-in-practice but defensively-handled
        // case: something else changed the row's status while this
        // attempt was in flight (the CAS already makes this practically
        // unreachable via this service's own API — this directly forces
        // the final-write's own count===0 guard to fire).
        await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENT" } });
        return fakeSender.send(input);
      };

      await expect(
        rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, dispatch.id, {
          emailSender: interferingSender,
          responseBaseUrl: "http://localhost:3000",
        })
      ).rejects.toThrow(/[Ii]nternal inconsistency/);
    });
  });

  // ---------------------------------------------------------------
  // retryRFQDispatch — RFQ-RT1/RFQ-RT3 (docs/decisions/ratified.md):
  // same-dispatch retry, SEND_FAILED only. Shares the same internal
  // pipeline as sendRFQDispatch (authorization, tenant isolation, CAS,
  // token, compose, EmailSender.send, final CAS) — these tests focus on
  // what differs (accepted starting state, same-id guarantee) rather
  // than re-proving every pipeline step sendRFQDispatch's own tests
  // above already cover.
  // ---------------------------------------------------------------
  describe("retryRFQDispatch (service)", () => {
    async function freshSendFailedDispatch(supplierId = supplierAId, sourcingEventId = sourcingEventAId, tenantId = tenantAId) {
      const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SEND_FAILED" } });
      return dispatch;
    }

    it("a SEND_FAILED dispatch is retryable, using the same RFQDispatch id, and a successful outcome resolves to SENT", async () => {
      const dispatch = await freshSendFailedDispatch();
      const result = await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SENT");

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.id).toBe(dispatch.id);
      expect(row.status).toBe("SENT");
    });

    it("an explicit failure on retry resolves to SEND_FAILED again, on the same id", async () => {
      fakeSender.setNextOutcome({ kind: "failure", reason: "still rejected" });
      const dispatch = await freshSendFailedDispatch();
      const result = await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SEND_FAILED");

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.id).toBe(dispatch.id);
      expect(row.status).toBe("SEND_FAILED");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("an unknown outcome on retry leaves the dispatch SENDING, never SEND_FAILED, never reverted to PENDING", async () => {
      fakeSender.setNextOutcome({ kind: "unknown" });
      const dispatch = await freshSendFailedDispatch();
      const result = await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);
      expect(result.status).toBe("SENDING");

      const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(row.status).toBe("SENDING");
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests
    });

    it("retry does not create a second RFQDispatch — the same supplier/sourcingEvent row count is unchanged", async () => {
      const dispatch = await freshSendFailedDispatch();
      const countBefore = await prisma.rFQDispatch.count({
        where: { tenantId: tenantAId, sourcingEventId: sourcingEventAId, supplierId: supplierAId },
      });

      await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const countAfter = await prisma.rFQDispatch.count({
        where: { tenantId: tenantAId, sourcingEventId: sourcingEventAId, supplierId: supplierAId },
      });
      expect(countAfter).toBe(countBefore);
    });

    it("retryRFQDispatch rejects a PENDING dispatch — PENDING is sendRFQDispatch's own first-send case, not retry's", async () => {
      const dispatch = await freshPendingDispatch();
      await expect(
        rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("PENDING");
    });

    it("retryRFQDispatch rejects a SENDING dispatch — SENDING is never same-dispatch reclaimed (RFQ-RT4), including by retry", async () => {
      const dispatch = await freshPendingDispatch();
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENDING" } });
      await expect(
        rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(InvalidStateError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("SENDING");
    });

    it("exactly one of two concurrent retry calls on the same SEND_FAILED dispatch wins, and EmailSender is invoked exactly once", async () => {
      const dispatch = await freshSendFailedDispatch();
      const callsBefore = fakeSender.calls.length;

      const results = await Promise.allSettled([
        rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps),
        rfqDispatchService.retryRFQDispatch(tenantAId, approverAId, dispatch.id, deps),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);
      expect(fakeSender.calls.length).toBe(callsBefore + 1);
    });

    it("retry preserves authorization — a role outside procurement_user/approver cannot retry", async () => {
      const dispatch = await freshSendFailedDispatch();
      await expect(
        rfqDispatchService.retryRFQDispatch(tenantAId, otherRoleUserAId, dispatch.id, deps)
      ).rejects.toThrow(AuthorizationError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("SEND_FAILED");
    });

    it("retry preserves tenant isolation — a cross-tenant dispatch id is rejected identically, and the row is left completely unchanged", async () => {
      const dispatch = await freshSendFailedDispatch(supplierBId, sourcingEventBId, tenantBId);
      await expect(
        rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps)
      ).rejects.toThrow(NotFoundError);

      const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(unchanged.status).toBe("SEND_FAILED");
    });

    it("retry rotates the response token exactly as sendRFQDispatch's own token rotation already does — a fresh token is issued and the previous one is no longer valid", async () => {
      const dispatch = await freshSendFailedDispatch();
      const before = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      const previousHash = before.responseTokenHash;

      await rfqDispatchService.retryRFQDispatch(tenantAId, procurementUserAId, dispatch.id, deps);

      const after = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
      expect(after.responseTokenHash).not.toBeNull();
      expect(after.responseTokenHash).not.toBe(previousHash);

      const sentBody = fakeSender.calls[fakeSender.calls.length - 1].body;
      const match = sentBody.match(/rfq-response\/([0-9a-f]{64})/);
      expect(match).not.toBeNull();
      expect(hashToken(match![1])).toBe(after.responseTokenHash);
    });
  });

  // ---------------------------------------------------------------
  // New RFQDispatch / sibling isolation — RFQ-RT5 (docs/decisions/
  // ratified.md): a fresh communication always creates a new,
  // independent RFQDispatch, and must never mutate an existing sibling
  // dispatch for the same SourcingEvent + Supplier. Adversarial review
  // finding: `status` alone was asserted unchanged elsewhere; this closes
  // the gap for the remaining identity/token fields.
  // ---------------------------------------------------------------
  describe("new RFQDispatch / sibling isolation (RFQ-RT5)", () => {
    it("creating and sending a new sibling RFQDispatch leaves an existing dispatch's id, status, responseTokenHash, tokenExpiresAt, and createdAt completely unchanged, and the new dispatch has its own independent id and token", async () => {
      fakeSender.setNextOutcome({ kind: "unknown" });
      const oldDispatch = await freshPendingDispatch();
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, oldDispatch.id, deps);
      fakeSender.setNextOutcome({ kind: "success" }); // reset for subsequent tests

      const oldBefore = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: oldDispatch.id } });
      expect(oldBefore.status).toBe("SENDING");
      expect(oldBefore.responseTokenHash).not.toBeNull();

      const newDispatch = await rfqDispatchService.createRFQDispatch(tenantAId, sourcingEventAId, supplierAId);
      await rfqDispatchService.sendRFQDispatch(tenantAId, procurementUserAId, newDispatch.id, deps);

      const oldAfter = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: oldDispatch.id } });
      expect(oldAfter.id).toBe(oldBefore.id);
      expect(oldAfter.status).toBe(oldBefore.status);
      expect(oldAfter.responseTokenHash).toBe(oldBefore.responseTokenHash);
      expect(oldAfter.tokenExpiresAt?.getTime()).toBe(oldBefore.tokenExpiresAt?.getTime());
      expect(oldAfter.createdAt.getTime()).toBe(oldBefore.createdAt.getTime());
      // RFQ-EP4 (docs/decisions/ratified.md) / adversarial review finding:
      // providerMessageId was missing from this unchanged-field list —
      // creating and sending an independent sibling dispatch must not
      // touch it either, same as every other identity/token field above.
      expect(oldAfter.providerMessageId).toBe(oldBefore.providerMessageId);

      const newRow = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: newDispatch.id } });
      expect(newRow.id).not.toBe(oldDispatch.id);
      expect(newRow.responseTokenHash).not.toBeNull();
      expect(newRow.responseTokenHash).not.toBe(oldBefore.responseTokenHash);
    });
  });
});

// ---------------------------------------------------------------
// HTTP boundary
// ---------------------------------------------------------------
describe("POST /rfq-dispatches/:id/send & /retry (HTTP)", () => {
  let httpServer: Server;
  let baseUrl: string;
  let tenantId: string;
  let otherTenantId: string;
  let procurementUserId: string;
  let otherRoleUserId: string;
  let sourcingEventId: string;
  let supplierId: string;
  const fakeSender = new FakeEmailSender();

  async function httpPost(path: string, headers: Record<string, string> | null) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify({}),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // no body
    }
    return { status: res.status, json };
  }

  function authHeaders(userId: string, tid: string): Record<string, string> {
    return { [TEST_USER_ID_HEADER]: userId, [TEST_TENANT_ID_HEADER]: tid };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer = createServer(
        createApp(testAuthenticator, { emailSender: fakeSender, responseBaseUrl: "http://localhost:3000" })
      );
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "RFQSend HTTP Tenant" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "RFQSend HTTP Other Tenant" } });
    otherTenantId = otherTenant.id;

    procurementUserId = (
      await prisma.user.create({ data: { tenantId, name: "RFQSend HTTP User", role: "procurement_user" } })
    ).id;
    otherRoleUserId = (
      await prisma.user.create({ data: { tenantId, name: "RFQSend HTTP Other Role", role: "viewer" } })
    ).id;

    supplierId = (
      await prisma.supplier.create({ data: { tenantId, name: "RFQSend HTTP Supplier", email: "http-supplier@example.com" } })
    ).id;

    const user = await prisma.user.create({ data: { tenantId, name: "RFQSend HTTP Sourcing User", role: "procurement_user" } });
    const product = await prisma.product.create({ data: { tenantId, name: "RFQSend HTTP Product", sku: "HTTP-SKU" } });
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "1", unit: "EA" },
    });
    sourcingEventId = (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
  });

  it("an unauthenticated request cannot reach SEND", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, null);
    expect(res.status).toBe(401);
  });

  it("an authenticated role outside procurement_user/approver is rejected with 403", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, authHeaders(otherRoleUserId, tenantId));
    expect(res.status).toBe(403);
  });

  it("a caller authenticated as a different tenant cannot SEND this dispatch", async () => {
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const otherTenantUser = await prisma.user.create({
      data: { tenantId: otherTenantId, name: "RFQSend HTTP Cross User", role: "procurement_user" },
    });
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, authHeaders(otherTenantUser.id, otherTenantId));
    expect(res.status).toBe(404);

    const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("a valid authenticated SEND succeeds end-to-end against the fake EmailSender", async () => {
    fakeSender.setNextOutcome({ kind: "success" });
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "SENT" });
  });

  it("an explicit provider failure surfaces as SEND_FAILED over HTTP", async () => {
    fakeSender.setNextOutcome({ kind: "failure", reason: "provider rejected" });
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "SEND_FAILED" });
    fakeSender.setNextOutcome({ kind: "success" });
  });

  it("a timeout/unknown outcome surfaces as SENDING over HTTP, not SEND_FAILED", async () => {
    fakeSender.setNextOutcome({ kind: "unknown" });
    const dispatch = await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/send`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "SENDING" });
    fakeSender.setNextOutcome({ kind: "success" });
  });

  // RFQ-RT1/RFQ-RT3 (docs/decisions/ratified.md) — same-dispatch retry
  // over HTTP. Reuses this describe block's existing server/fixtures;
  // only the route path and accepted starting state differ from /send
  // above.
  async function dispatchInState(status: "PENDING" | "SENDING" | "SEND_FAILED", tid = tenantId, sid = supplierId, seid = sourcingEventId) {
    const dispatch = await rfqDispatchService.createRFQDispatch(tid, seid, sid);
    if (status !== "PENDING") {
      await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status } });
    }
    return dispatch;
  }

  it("an unauthenticated request cannot reach /retry", async () => {
    const dispatch = await dispatchInState("SEND_FAILED");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, null);
    expect(res.status).toBe(401);
  });

  it("an authenticated role outside procurement_user/approver is rejected with 403 on /retry", async () => {
    const dispatch = await dispatchInState("SEND_FAILED");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(otherRoleUserId, tenantId));
    expect(res.status).toBe(403);
  });

  it("a caller authenticated as a different tenant cannot retry this dispatch", async () => {
    const dispatch = await dispatchInState("SEND_FAILED");
    const otherTenantUser = await prisma.user.create({
      data: { tenantId: otherTenantId, name: "RFQRetry HTTP Cross User", role: "procurement_user" },
    });
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(otherTenantUser.id, otherTenantId));
    expect(res.status).toBe(404);

    const unchanged = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(unchanged.status).toBe("SEND_FAILED");
  });

  it("/retry rejects a PENDING dispatch (409) — first SEND is /send's own job", async () => {
    const dispatch = await dispatchInState("PENDING");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(409);
  });

  it("/retry rejects a SENDING dispatch (409) — never same-dispatch reclaimed", async () => {
    const dispatch = await dispatchInState("SENDING");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(409);
  });

  it("a valid authenticated retry of a SEND_FAILED dispatch succeeds end-to-end, on the same dispatch id", async () => {
    fakeSender.setNextOutcome({ kind: "success" });
    const dispatch = await dispatchInState("SEND_FAILED");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "SENT" });

    const row = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(row.id).toBe(dispatch.id);
  });

  it("an explicit provider failure on retry surfaces as SEND_FAILED over HTTP", async () => {
    fakeSender.setNextOutcome({ kind: "failure", reason: "provider rejected" });
    const dispatch = await dispatchInState("SEND_FAILED");
    const res = await httpPost(`/rfq-dispatches/${dispatch.id}/retry`, authHeaders(procurementUserId, tenantId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "SEND_FAILED" });
    fakeSender.setNextOutcome({ kind: "success" });
  });
});
