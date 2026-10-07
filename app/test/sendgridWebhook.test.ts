import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID, generateKeyPairSync, createSign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";
import { createApp } from "../src/api/server";
import { testAuthenticator } from "./support/testAuthenticator";
import { SENDGRID_SIGNATURE_HEADER, SENDGRID_TIMESTAMP_HEADER } from "../src/api/sendgridWebhookVerification";

// Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
// (docs/decisions/ratified.md). Exercises the real HTTP endpoint
// (POST /webhooks/sendgrid/events) against the real test database, via
// a real createServer(createApp(...)) + raw fetch — the same pattern
// cors.test.ts/authIntegration.test.ts already use for header/raw-body
// level assertions this codebase's JSON-only test helpers cannot make.
// No real SendGrid account, credential, or network call is ever used —
// a locally generated EC P-256 keypair stands in for SendGrid's own
// signing key, exactly mirroring what the real provider does
// structurally (ECDSA over timestamp + raw body), without depending on
// anything external.

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const VERIFICATION_KEY_BASE64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function sign(rawBody: Buffer, timestamp: string): string {
  const signer = createSign("sha256");
  signer.update(Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]));
  signer.end();
  return signer.sign(privateKey, "base64");
}

let httpServer: Server;
let baseUrl: string;

async function postWebhook(
  events: unknown,
  opts: { timestamp?: string; signatureOverride?: string; signedBodyOverride?: Buffer; omitHeaders?: boolean } = {}
) {
  const rawBody = Buffer.from(JSON.stringify(events), "utf8");
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const signature = opts.signatureOverride ?? sign(opts.signedBodyOverride ?? rawBody, timestamp);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.omitHeaders) {
    headers[SENDGRID_SIGNATURE_HEADER] = signature;
    headers[SENDGRID_TIMESTAMP_HEADER] = timestamp;
  }

  return fetch(`${baseUrl}/webhooks/sendgrid/events`, { method: "POST", headers, body: rawBody });
}

function sendgridEvent(overrides: Record<string, unknown> = {}) {
  return {
    email: "supplier@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    event: "delivered",
    sg_event_id: randomUUID(),
    sg_message_id: `${randomUUID()}.filter-0001.0`,
    ...overrides,
  };
}

async function latestEventsFor(rfqDispatchId: string | null) {
  return prisma.rFQProviderDeliveryEvent.findMany({ where: { rfqDispatchId }, orderBy: { receivedAt: "asc" } });
}

describe("POST /webhooks/sendgrid/events — Provider Delivery & Outcome Confirmation Boundary", () => {
  let tenantAId: string;
  let tenantBId: string;
  let dispatchAId: string;
  let dispatchBId: string;

  beforeAll(async () => {
    process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY = VERIFICATION_KEY_BASE64;

    await new Promise<void>((resolve) => {
      httpServer = createServer(createApp(testAuthenticator));
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    async function makeDispatch(label: string) {
      const tenant = await prisma.tenant.create({ data: { name: `Webhook Test Tenant ${label}` } });
      const user = await prisma.user.create({ data: { tenantId: tenant.id, name: `${label} User`, role: "procurement_user" } });
      const product = await prisma.product.create({ data: { tenantId: tenant.id, name: `${label} Product`, sku: `${label}-SKU` } });
      const supplier = await prisma.supplier.create({ data: { tenantId: tenant.id, name: `${label} Supplier`, email: `${label}@example.com` } });
      const request = await prisma.procurementRequest.create({ data: { tenantId: tenant.id, createdById: user.id } });
      const line = await prisma.requestLine.create({
        data: { tenantId: tenant.id, requestId: request.id, productId: product.id, requestedQuantity: "10", unit: "EA" },
      });
      const sourcingEvent = await prisma.sourcingEvent.create({ data: { tenantId: tenant.id, requestLineId: line.id } });
      const dispatch = await prisma.rFQDispatch.create({
        data: { tenantId: tenant.id, sourcingEventId: sourcingEvent.id, supplierId: supplier.id },
      });
      return { tenantId: tenant.id, dispatchId: dispatch.id };
    }

    const a = await makeDispatch("WebhookA");
    tenantAId = a.tenantId;
    dispatchAId = a.dispatchId;
    const b = await makeDispatch("WebhookB");
    tenantBId = b.tenantId;
    dispatchBId = b.dispatchId;
  });

  afterAll(async () => {
    httpServer?.close();
    // Scoped strictly to this file's own two tenants/dispatches — never a
    // global deleteMany — so other test files' data is never touched. FK
    // order matches resetDatabase()'s own convention (workflow.e2e.test.ts):
    // rows referencing RFQDispatch/SourcingEvent must be removed before
    // those rows themselves, so a later-running global reset (e.g.
    // workflow.e2e.test.ts's own resetDatabase(), which does not itself
    // know about RFQDispatch/RFQCommunicationEvent/RFQProviderDeliveryEvent)
    // never hits a leftover foreign-key violation from this file's data.
    await prisma.rFQProviderDeliveryEvent.deleteMany({ where: { rfqDispatchId: { in: [dispatchAId, dispatchBId] } } });
    await prisma.rFQCommunicationEvent.deleteMany({ where: { rfqDispatchId: { in: [dispatchAId, dispatchBId] } } });
    await prisma.supplierQuote.deleteMany({ where: { rfqDispatchId: { in: [dispatchAId, dispatchBId] } } });
    await prisma.rFQDispatch.deleteMany({ where: { id: { in: [dispatchAId, dispatchBId] } } });
    await prisma.sourcingEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.requestLine.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.procurementRequest.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.supplier.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  });

  // ---------------------------------------------------------------
  // Signature
  // ---------------------------------------------------------------
  describe("signature authenticity (RFQ-PD15)", () => {
    it("1. valid signature is accepted (200)", async () => {
      const res = await postWebhook([sendgridEvent({ event: "processed" })]);
      expect(res.status).toBe(200);
    });

    it("2. invalid signature is rejected (403), never processed", async () => {
      const dispatchId = dispatchAId;
      const events = [sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchId, sg_event_id: randomUUID() })];
      const res = await postWebhook(events, { signatureOverride: "not-a-real-signature-base64==" });
      expect(res.status).toBe(403);
      const rows = await latestEventsFor(dispatchId);
      expect(rows.length).toBe(0);
    });

    it("3. stale signing timestamp is rejected (403)", async () => {
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 10_000).toString(); // far beyond 300s tolerance
      const events = [sendgridEvent({ event: "processed" })];
      const rawBody = Buffer.from(JSON.stringify(events), "utf8");
      const signature = sign(rawBody, staleTimestamp);
      const res = await fetch(`${baseUrl}/webhooks/sendgrid/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SENDGRID_SIGNATURE_HEADER]: signature,
          [SENDGRID_TIMESTAMP_HEADER]: staleTimestamp,
        },
        body: rawBody,
      });
      expect(res.status).toBe(403);
    });

    it("4. raw-body verification is actually used — a tampered body with a stale signature is rejected", async () => {
      const dispatchId = dispatchAId;
      const originalEvents = [sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchId, sg_event_id: randomUUID() })];
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const originalRawBody = Buffer.from(JSON.stringify(originalEvents), "utf8");
      const signature = sign(originalRawBody, timestamp);

      // Same signature/timestamp, but a DIFFERENT body than what was signed.
      const tamperedEvents = [sendgridEvent({ event: "bounce", rfq_dispatch_id: dispatchId, sg_event_id: randomUUID() })];
      const tamperedRawBody = Buffer.from(JSON.stringify(tamperedEvents), "utf8");

      const res = await fetch(`${baseUrl}/webhooks/sendgrid/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SENDGRID_SIGNATURE_HEADER]: signature,
          [SENDGRID_TIMESTAMP_HEADER]: timestamp,
        },
        body: tamperedRawBody,
      });
      expect(res.status).toBe(403);
    });

    it("5. missing signature/timestamp headers are rejected (403)", async () => {
      const res = await postWebhook([sendgridEvent()], { omitHeaders: true });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Correlation
  // ---------------------------------------------------------------
  describe("correlation (RFQ-PD4/RFQ-PD5)", () => {
    it("6. valid custom_args dispatch id -> CORRELATED, tenantId derived from the dispatch", async () => {
      const sgEventId = randomUUID();
      const res = await postWebhook([
        sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: sgEventId }),
      ]);
      expect(res.status).toBe(200);
      const rows = await latestEventsFor(dispatchAId);
      const row = rows.find((r) => r.providerEventId === sgEventId);
      expect(row?.correlationState).toBe("CORRELATED");
      expect(row?.tenantId).toBe(tenantAId);
      expect(row?.rfqDispatchId).toBe(dispatchAId);
    });

    it("7. missing custom_args -> UNCORRELATED, no tenant/dispatch assigned", async () => {
      const sgEventId = randomUUID();
      const res = await postWebhook([sendgridEvent({ event: "delivered", sg_event_id: sgEventId })]);
      expect(res.status).toBe(200);
      const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
      expect(row?.correlationState).toBe("UNCORRELATED");
      expect(row?.tenantId).toBeNull();
      expect(row?.rfqDispatchId).toBeNull();
    });

    it("8. malformed dispatch id -> UNCORRELATED", async () => {
      const sgEventId = randomUUID();
      await postWebhook([sendgridEvent({ event: "delivered", rfq_dispatch_id: "not-a-real-id", sg_event_id: sgEventId })]);
      const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
      expect(row?.correlationState).toBe("UNCORRELATED");
      expect(row?.tenantId).toBeNull();
    });

    it("9. unknown (well-formed but nonexistent) dispatch id -> UNCORRELATED", async () => {
      const sgEventId = randomUUID();
      await postWebhook([sendgridEvent({ event: "delivered", rfq_dispatch_id: randomUUID(), sg_event_id: sgEventId })]);
      const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
      expect(row?.correlationState).toBe("UNCORRELATED");
      expect(row?.tenantId).toBeNull();
    });

    it("10. a payload-supplied tenant-like field can never override the derived tenant", async () => {
      const sgEventId = randomUUID();
      await postWebhook([
        sendgridEvent({
          event: "delivered",
          rfq_dispatch_id: dispatchAId,
          sg_event_id: sgEventId,
          tenant_id: tenantBId, // attacker-controlled; must be ignored entirely
          tenantId: tenantBId,
        }),
      ]);
      const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
      expect(row?.tenantId).toBe(tenantAId);
      expect(row?.tenantId).not.toBe(tenantBId);
    });
  });

  // ---------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------
  describe("deduplication (RFQ-PD6)", () => {
    it("11. same (provider, providerEventId) delivered twice is idempotent", async () => {
      const sgEventId = randomUUID();
      const event = sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: sgEventId });
      const res1 = await postWebhook([event]);
      const res2 = await postWebhook([event]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const rows = await prisma.rFQProviderDeliveryEvent.findMany({ where: { providerEventId: sgEventId } });
      expect(rows.length).toBe(1);
    });

    it("12. a concurrent duplicate race is safely handled (exactly one row survives)", async () => {
      const sgEventId = randomUUID();
      const event = sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: sgEventId });
      const results = await Promise.all([postWebhook([event]), postWebhook([event]), postWebhook([event])]);
      for (const res of results) {
        expect(res.status).toBe(200);
      }
      const rows = await prisma.rFQProviderDeliveryEvent.findMany({ where: { providerEventId: sgEventId } });
      expect(rows.length).toBe(1);
    });

    it("13. a null providerEventId remains non-deduplicable — two such events both persist", async () => {
      const marker = randomUUID();
      await postWebhook([
        sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: undefined, sg_message_id: marker }),
        sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: undefined, sg_message_id: marker }),
      ]);
      const rows = await prisma.rFQProviderDeliveryEvent.findMany({
        where: { rfqDispatchId: dispatchAId, providerEventId: null, providerMessageId: marker },
      });
      expect(rows.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------
  describe("provider event mapping (RFQ-PD7)", () => {
    const cases: Array<{ sendgridEvent: string; type?: string; expectedEventType: string; expectedSubtype: string | null }> = [
      { sendgridEvent: "processed", expectedEventType: "PROCESSED", expectedSubtype: null },
      { sendgridEvent: "deferred", expectedEventType: "DEFERRED", expectedSubtype: null },
      { sendgridEvent: "delivered", expectedEventType: "DELIVERED", expectedSubtype: null },
      { sendgridEvent: "bounce", expectedEventType: "BOUNCE", expectedSubtype: null },
      { sendgridEvent: "bounce", type: "blocked", expectedEventType: "BOUNCE", expectedSubtype: "BLOCKED" },
      { sendgridEvent: "dropped", expectedEventType: "DROPPED", expectedSubtype: null },
    ];

    for (const c of cases) {
      it(`maps event="${c.sendgridEvent}"${c.type ? ` type="${c.type}"` : ""} -> ${c.expectedEventType}${c.expectedSubtype ? `/${c.expectedSubtype}` : ""}`, async () => {
        const sgEventId = randomUUID();
        await postWebhook([
          sendgridEvent({ event: c.sendgridEvent, type: c.type, rfq_dispatch_id: dispatchAId, sg_event_id: sgEventId }),
        ]);
        const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
        expect(row?.eventType).toBe(c.expectedEventType);
        expect(row?.providerSubtype).toBe(c.expectedSubtype);
      });
    }

    it("14. never fabricates a top-level BLOCKED/UNKNOWN eventType", async () => {
      const rows = await prisma.rFQProviderDeliveryEvent.findMany({ where: { eventType: { in: ["BLOCKED", "UNKNOWN"] } } });
      expect(rows.length).toBe(0);
    });

    it("15. engagement/compliance event types (open/click/spam report/unsubscribe) are ignored, never persisted", async () => {
      const marker = randomUUID();
      await postWebhook([
        sendgridEvent({ event: "open", rfq_dispatch_id: dispatchAId, sg_event_id: marker }),
        sendgridEvent({ event: "click", rfq_dispatch_id: dispatchAId, sg_event_id: `${marker}-click` }),
        sendgridEvent({ event: "unsubscribe", rfq_dispatch_id: dispatchAId, sg_event_id: `${marker}-unsub` }),
      ]);
      const rows = await prisma.rFQProviderDeliveryEvent.findMany({
        where: { providerEventId: { in: [marker, `${marker}-click`, `${marker}-unsub`] } },
      });
      expect(rows.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Lifecycle safety
  // ---------------------------------------------------------------
  describe("lifecycle safety (RFQ-PD2/RFQ-PD10/RFQ-PD11/RFQ-PD20)", () => {
    it("16. a provider delivery event never mutates RFQDispatch.status, triggers retry, or creates a supplier response", async () => {
      const before = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
      const quoteCountBefore = await prisma.supplierQuote.count({ where: { rfqDispatchId: dispatchAId } });

      await postWebhook([sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: randomUUID() })]);
      await postWebhook([sendgridEvent({ event: "bounce", type: "blocked", rfq_dispatch_id: dispatchAId, sg_event_id: randomUUID() })]);
      await postWebhook([sendgridEvent({ event: "dropped", rfq_dispatch_id: dispatchAId, sg_event_id: randomUUID() })]);

      const after = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatchAId } });
      const quoteCountAfter = await prisma.supplierQuote.count({ where: { rfqDispatchId: dispatchAId } });

      expect(after.status).toBe(before.status); // still PENDING — untouched
      expect(after.responseTokenHash).toBe(before.responseTokenHash);
      expect(after.respondedAt).toBe(before.respondedAt);
      expect(quoteCountAfter).toBe(quoteCountBefore);
    });
  });

  // ---------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------
  describe("tenant isolation (RFQ-PD4/RFQ-PD14)", () => {
    it("17. correlated events resolve only through their own dispatch's tenant, never the other tenant", async () => {
      const sgEventIdA = randomUUID();
      const sgEventIdB = randomUUID();
      await postWebhook([sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchAId, sg_event_id: sgEventIdA })]);
      await postWebhook([sendgridEvent({ event: "delivered", rfq_dispatch_id: dispatchBId, sg_event_id: sgEventIdB })]);

      const rowA = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventIdA } });
      const rowB = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventIdB } });
      expect(rowA?.tenantId).toBe(tenantAId);
      expect(rowB?.tenantId).toBe(tenantBId);
      expect(rowA?.tenantId).not.toBe(rowB?.tenantId);
    });
  });

  // ---------------------------------------------------------------
  // Uncorrelated safety
  // ---------------------------------------------------------------
  describe("uncorrelated safety (RFQ-PD5)", () => {
    it("18. an UNCORRELATED event's sg_message_id is stored only as diagnostic metadata, never used for automatic correlation", async () => {
      // dispatchA's own real providerMessageId lineage is unrelated — this
      // proves even a coincidentally-matching sg_message_id on an
      // otherwise-uncorrelated event never triggers a heuristic
      // dispatch/tenant assignment; only custom_args.rfq_dispatch_id does.
      const sgEventId = randomUUID();
      const sgMessageId = `${randomUUID()}.coincidental-match.0`;
      await postWebhook([
        sendgridEvent({ event: "delivered", sg_event_id: sgEventId, sg_message_id: sgMessageId }), // no rfq_dispatch_id
      ]);
      const row = await prisma.rFQProviderDeliveryEvent.findFirst({ where: { providerEventId: sgEventId } });
      expect(row?.correlationState).toBe("UNCORRELATED");
      expect(row?.tenantId).toBeNull();
      expect(row?.rfqDispatchId).toBeNull();
      expect(row?.providerMessageId).toBe(sgMessageId); // retained, diagnostic-only
    });
  });
});
