import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";
import * as queryService from "../src/services/queryService";
import * as rfqDispatchService from "../src/services/rfqDispatchService";
import { NotFoundError } from "../src/domain/errors";
import { createApp } from "../src/api/server";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";

// Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
// (docs/decisions/ratified.md) — read-only operational-visibility
// extension (queryService.listRfqProviderDeliveryEvents,
// GET /rfq-dispatches/:id/provider-events). Reuses RFQ-EH7's already-
// ratified read floor; not a new semantic decision. Fixtures are
// written directly via the bare `prisma` client (matching
// providerDeliveryEventService.ts's own convention for this model, and
// avoiding any dependency on real webhook signing — that boundary is
// already covered by sendgridWebhook.test.ts).

describe("listRfqProviderDeliveryEvents (service)", () => {
  let tenantAId: string;
  let tenantBId: string;
  let dispatchAId: string;
  let otherDispatchAId: string;
  let dispatchBId: string;

  beforeAll(async () => {
    async function makeDispatch(tenantId: string, label: string) {
      const user = await prisma.user.create({ data: { tenantId, name: `${label} User`, role: "procurement_user" } });
      const product = await prisma.product.create({ data: { tenantId, name: `${label} Product`, sku: `${label}-SKU` } });
      const supplier = await prisma.supplier.create({ data: { tenantId, name: `${label} Supplier`, email: `${label}@example.com` } });
      const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
      const line = await prisma.requestLine.create({
        data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "1", unit: "EA" },
      });
      const sourcingEvent = await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } });
      return (await prisma.rFQDispatch.create({ data: { tenantId, sourcingEventId: sourcingEvent.id, supplierId: supplier.id } })).id;
    }

    const tenantA = await prisma.tenant.create({ data: { name: "ProviderDeliveryRead Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "ProviderDeliveryRead Tenant B" } });
    tenantBId = tenantB.id;

    dispatchAId = await makeDispatch(tenantAId, "PDRead-A");
    otherDispatchAId = await makeDispatch(tenantAId, "PDRead-A-Other");
    dispatchBId = await makeDispatch(tenantBId, "PDRead-B");

    // Two CORRELATED events for dispatchA (one plain, one bounce/blocked).
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "CORRELATED",
        tenantId: tenantAId,
        rfqDispatchId: dispatchAId,
        eventType: "DELIVERED",
        providerEventAt: new Date(),
      },
    });
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "CORRELATED",
        tenantId: tenantAId,
        rfqDispatchId: dispatchAId,
        eventType: "BOUNCE",
        providerSubtype: "BLOCKED",
        providerMessageId: "diagnostic-only-should-never-be-returned",
        providerEventAt: new Date(),
      },
    });
    // A CORRELATED event for a DIFFERENT dispatch under the SAME tenant —
    // proves dispatch-scoping, not merely tenant-scoping.
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "CORRELATED",
        tenantId: tenantAId,
        rfqDispatchId: otherDispatchAId,
        eventType: "PROCESSED",
        providerEventAt: new Date(),
      },
    });
    // An UNCORRELATED event (tenantId/rfqDispatchId both null) — must
    // never be returned by any tenant-scoped read (RFQ-PD5).
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "UNCORRELATED",
        tenantId: null,
        rfqDispatchId: null,
        eventType: "DELIVERED",
        providerEventAt: new Date(),
      },
    });
    // A CORRELATED event for tenantB's own dispatch — proves cross-tenant isolation.
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "CORRELATED",
        tenantId: tenantBId,
        rfqDispatchId: dispatchBId,
        eventType: "DELIVERED",
        providerEventAt: new Date(),
      },
    });
  });

  it("1. returns only the CORRELATED events belonging to the requested tenant and dispatch", async () => {
    const events = await queryService.listRfqProviderDeliveryEvents(tenantAId, dispatchAId);
    expect(events.length).toBe(2);
    expect(events.map((e) => e.eventType).sort()).toEqual(["BOUNCE", "DELIVERED"]);
  });

  it("2. does not return another dispatch's events, even under the same tenant", async () => {
    const events = await queryService.listRfqProviderDeliveryEvents(tenantAId, dispatchAId);
    expect(events.some((e) => e.eventType === "PROCESSED")).toBe(false);
  });

  it("3. a different tenant cannot read tenant A's dispatch events (NotFoundError)", async () => {
    await expect(queryService.listRfqProviderDeliveryEvents(tenantBId, dispatchAId)).rejects.toThrow(NotFoundError);
  });

  it("4. UNCORRELATED events are never returned, under any tenant", async () => {
    const eventsA = await queryService.listRfqProviderDeliveryEvents(tenantAId, dispatchAId);
    const eventsB = await queryService.listRfqProviderDeliveryEvents(tenantBId, dispatchBId);
    const allReturned = [...eventsA, ...eventsB];
    // An UNCORRELATED row has no rfqDispatchId at all, so it can never
    // equal either dispatch id above — this also directly proves no
    // uncorrelated row leaked through disguised as one of these.
    expect(allReturned.length).toBe(3); // 2 for dispatchA + 1 for dispatchB
  });

  it("5. the explicit select never exposes providerMessageId, correlationState, provider, tenantId, or rfqDispatchId", async () => {
    const events = await queryService.listRfqProviderDeliveryEvents(tenantAId, dispatchAId);
    for (const event of events) {
      expect(event).not.toHaveProperty("providerMessageId");
      expect(event).not.toHaveProperty("correlationState");
      expect(event).not.toHaveProperty("provider");
      expect(event).not.toHaveProperty("tenantId");
      expect(event).not.toHaveProperty("rfqDispatchId");
    }
  });

  it("6. a bounce/blocked event's providerSubtype is returned alongside eventType=BOUNCE, never as a top-level BLOCKED type", async () => {
    const events = await queryService.listRfqProviderDeliveryEvents(tenantAId, dispatchAId);
    const bounce = events.find((e) => e.eventType === "BOUNCE");
    expect(bounce?.providerSubtype).toBe("BLOCKED");
    expect(events.some((e) => (e.eventType as string) === "BLOCKED")).toBe(false);
  });

  it("7. a nonexistent dispatch id is rejected identically to a cross-tenant one (NotFoundError)", async () => {
    await expect(queryService.listRfqProviderDeliveryEvents(tenantAId, randomUUID())).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------
// GET /rfq-dispatches/:id/provider-events (HTTP) — RFQ-PD read boundary,
// mirroring rfqEventHistory.test.ts's own HTTP-level pattern exactly for
// GET /rfq-dispatches/:id/events.
// ---------------------------------------------------------------
describe("GET /rfq-dispatches/:id/provider-events (HTTP)", () => {
  let httpServer: Server;
  let baseUrl: string;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let dispatchId: string;

  async function httpGet(path: string, headers: Record<string, string> | null) {
    const res = await fetch(`${baseUrl}${path}`, { method: "GET", headers: headers ?? {} });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // no body
    }
    return { status: res.status, json };
  }

  function authHeaders(uid: string, tid: string): Record<string, string> {
    return { [TEST_USER_ID_HEADER]: uid, [TEST_TENANT_ID_HEADER]: tid };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer = createServer(createApp(testAuthenticator));
      httpServer.listen(0, () => {
        const address = httpServer.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const tenant = await prisma.tenant.create({ data: { name: "ProviderDeliveryRead HTTP Tenant" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "ProviderDeliveryRead HTTP Other Tenant" } });
    otherTenantId = otherTenant.id;

    userId = (await prisma.user.create({ data: { tenantId, name: "ProviderDeliveryRead HTTP User", role: "procurement_user" } })).id;
    const supplier = await prisma.supplier.create({
      data: { tenantId, name: "ProviderDeliveryRead HTTP Supplier", email: "pdrh@example.com" },
    });
    const product = await prisma.product.create({ data: { tenantId, name: "ProviderDeliveryRead HTTP Product", sku: "PDRH-SKU" } });
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: userId } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "1", unit: "EA" },
    });
    const sourcingEventId = (await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } })).id;
    dispatchId = (await rfqDispatchService.createRFQDispatch(tenantId, sourcingEventId, supplier.id)).id;

    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider: "SENDGRID",
        providerEventId: randomUUID(),
        correlationState: "CORRELATED",
        tenantId,
        rfqDispatchId: dispatchId,
        eventType: "DELIVERED",
        providerEventAt: new Date(),
      },
    });
  });

  it("8. an unauthenticated request cannot read provider delivery events", async () => {
    const res = await httpGet(`/rfq-dispatches/${dispatchId}/provider-events?tenantId=${tenantId}`, null);
    expect(res.status).toBe(401);
  });

  it("9. an authenticated same-tenant request succeeds and returns the DELIVERED event, with no internal field exposed", async () => {
    const res = await httpGet(`/rfq-dispatches/${dispatchId}/provider-events?tenantId=${tenantId}`, authHeaders(userId, tenantId));
    expect(res.status).toBe(200);
    const events = res.json as Record<string, unknown>[];
    expect(events.some((e) => e.eventType === "DELIVERED")).toBe(true);
    expect(events[0]).not.toHaveProperty("tenantId");
    expect(events[0]).not.toHaveProperty("providerMessageId");
  });

  it("10. a cross-tenant principal cannot read another tenant's dispatch provider-events (assertTenantMatches gate)", async () => {
    const otherUser = await prisma.user.create({
      data: { tenantId: otherTenantId, name: "ProviderDeliveryRead HTTP Other User", role: "procurement_user" },
    });
    const res = await httpGet(
      `/rfq-dispatches/${dispatchId}/provider-events?tenantId=${otherTenantId}`,
      authHeaders(otherUser.id, otherTenantId)
    );
    expect(res.status).toBe(404);
  });
});
