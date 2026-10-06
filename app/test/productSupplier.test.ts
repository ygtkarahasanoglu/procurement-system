import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/db/client";
import * as productService from "../src/services/productService";
import * as supplierService from "../src/services/supplierService";
import { createApp } from "../src/api/server";
import { testAuthenticator, TEST_USER_ID_HEADER, TEST_TENANT_ID_HEADER } from "./support/testAuthenticator";
import { ValidationError } from "../src/domain/errors";

// Tenant-scoped Product/Supplier creation (the exact, narrow feature from
// the read-only input-boundary micro-assessment: exposing creation of the
// EXISTING flat Product{name,sku}/Supplier{name} records only — no
// identity/master-data subsystem, no uniqueness, no PI-C*/R3 semantics).
// Follows adversarial.test.ts's own conventions: an in-process http.Server
// wrapping the real Express app + testAuthenticator, and this file's own
// isolated tenant fixtures so it cannot interfere with other suites under
// vitest's single-worker execution.

let httpServer: Server;
let baseUrl: string;

async function httpPost(path: string, body: unknown, headers: Record<string, string> | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, json };
}

describe("Tenant-scoped Product/Supplier creation", () => {
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;

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

    const tenantA = await prisma.tenant.create({ data: { name: "ProductSupplier Tenant A" } });
    tenantAId = tenantA.id;
    const tenantB = await prisma.tenant.create({ data: { name: "ProductSupplier Tenant B" } });
    tenantBId = tenantB.id;
    userAId = (
      await prisma.user.create({ data: { tenantId: tenantAId, name: "PS Test User A", role: "procurement_user" } })
    ).id;
  });

  function authHeaders(userId: string, tenantId: string): Record<string, string> {
    return { [TEST_USER_ID_HEADER]: userId, [TEST_TENANT_ID_HEADER]: tenantId };
  }

  // ---------------------------------------------------------------
  // 1-2. Authenticated tenant user can create Product / Supplier
  // ---------------------------------------------------------------
  it("1. an authenticated tenant user can create a Product via POST /products", async () => {
    const res = await httpPost("/products", { tenantId: tenantAId, name: "Widget", sku: "WID-1" }, authHeaders(userAId, tenantAId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tenantId: tenantAId, name: "Widget", sku: "WID-1" });
  });

  it("2. an authenticated tenant user can create a Supplier via POST /suppliers", async () => {
    const res = await httpPost("/suppliers", { tenantId: tenantAId, name: "Acme Supply Co" }, authHeaders(userAId, tenantAId));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tenantId: tenantAId, name: "Acme Supply Co" });
  });

  // ---------------------------------------------------------------
  // 3-5. Required-field validation
  // ---------------------------------------------------------------
  it("3. Product requires a non-empty name", async () => {
    await expect(productService.createProduct(tenantAId, "   ", "SKU-X")).rejects.toThrow(ValidationError);
  });

  it("4. Product requires a non-empty SKU", async () => {
    await expect(productService.createProduct(tenantAId, "Name", "   ")).rejects.toThrow(ValidationError);
  });

  it("5. Supplier requires a non-empty name", async () => {
    await expect(supplierService.createSupplier(tenantAId, "   ")).rejects.toThrow(ValidationError);
  });

  it("Product/Supplier reject a missing tenantId with ValidationError, not a raw error", async () => {
    await expect(productService.createProduct("", "Name", "SKU")).rejects.toThrow(ValidationError);
    await expect(supplierService.createSupplier("", "Name")).rejects.toThrow(ValidationError);
  });

  // ---------------------------------------------------------------
  // 6-7. tenantId cannot escape the authenticated Principal's tenant
  // ---------------------------------------------------------------
  it("6-7. a caller authenticated as tenant A claiming tenant B in the body is rejected by the existing tenant-boundary mechanism (assertTenantMatches), and nothing is created", async () => {
    const res = await httpPost(
      "/products",
      { tenantId: tenantBId, name: "Should Not Exist", sku: "SHOULD-NOT-EXIST" },
      authHeaders(userAId, tenantAId)
    );
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ error: "TenantMismatchError" });

    const leaked = await prisma.product.findFirst({ where: { sku: "SHOULD-NOT-EXIST" } });
    expect(leaked).toBeNull();
  });

  it("6-7. the same check holds for Supplier creation", async () => {
    const res = await httpPost(
      "/suppliers",
      { tenantId: tenantBId, name: "Should Not Exist Supplier" },
      authHeaders(userAId, tenantAId)
    );
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ error: "TenantMismatchError" });

    const leaked = await prisma.supplier.findFirst({ where: { name: "Should Not Exist Supplier" } });
    expect(leaked).toBeNull();
  });

  it("an unauthenticated request to either route is rejected with 401, never reaching the service", async () => {
    const resProduct = await httpPost("/products", { tenantId: tenantAId, name: "X", sku: "Y" }, null);
    expect(resProduct.status).toBe(401);
    const resSupplier = await httpPost("/suppliers", { tenantId: tenantAId, name: "X" }, null);
    expect(resSupplier.status).toBe(401);
  });

  // ---------------------------------------------------------------
  // 8-9. Creation routes through the tenantScoped() guard, not bare prisma
  // ---------------------------------------------------------------
  // The service functions' own signature makes a tenant MISMATCH
  // impossible to construct from outside (the one tenantId parameter is
  // used, identically, both as the guard's scope and the row's own
  // tenantId) — so this cannot be distinguished behaviorally from a
  // correctly-written bare-client call. The guard's own cross-tenant
  // rejection behavior for the Product model is already proven generically
  // in tenantGuard.test.ts. What is specific to these two new functions is
  // verified directly: they import and call tenantScoped(), not the bare
  // prisma client, for the actual mutation.
  it("8. productService.createProduct's implementation routes through tenantScoped(), not the bare prisma client", async () => {
    const source = await readFile(join(__dirname, "../src/services/productService.ts"), "utf-8");
    expect(source).toMatch(/tenantScoped\(/);
    expect(source).not.toMatch(/\bprisma\.product\.create/);
  });

  it("9. supplierService.createSupplier's implementation routes through tenantScoped(), not the bare prisma client", async () => {
    const source = await readFile(join(__dirname, "../src/services/supplierService.ts"), "utf-8");
    expect(source).toMatch(/tenantScoped\(/);
    expect(source).not.toMatch(/\bprisma\.supplier\.create/);
  });

  // ---------------------------------------------------------------
  // 10-11. No uniqueness was introduced — duplicates remain allowed
  // ---------------------------------------------------------------
  it("10. duplicate Product SKUs remain allowed", async () => {
    const first = await productService.createProduct(tenantAId, "Dup Product 1", "DUP-SKU");
    const second = await productService.createProduct(tenantAId, "Dup Product 2", "DUP-SKU");
    expect(first.id).not.toBe(second.id);
    expect(first.sku).toBe(second.sku);
  });

  it("11. duplicate Supplier names remain allowed", async () => {
    const first = await supplierService.createSupplier(tenantAId, "Dup Supplier");
    const second = await supplierService.createSupplier(tenantAId, "Dup Supplier");
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe(second.name);
  });

  // ---------------------------------------------------------------
  // A freshly-created Product/Supplier is immediately usable by the
  // existing procurement workflow (request -> quote), proving this
  // feature actually integrates with, rather than sitting beside, the
  // existing services.
  // ---------------------------------------------------------------
  it("a newly created Product and Supplier are immediately usable by the existing request/quote flow", async () => {
    const product = await productService.createProduct(tenantAId, "Freshly Created Product", "FRESH-SKU");
    const supplier = await supplierService.createSupplier(tenantAId, "Freshly Created Supplier");

    const requestService = await import("../src/services/requestService");
    const sourcingService = await import("../src/services/sourcingService");
    const quoteService = await import("../src/services/quoteService");

    const request = await requestService.createRequest({
      tenantId: tenantAId,
      createdById: userAId,
      lines: [{ productId: product.id, requestedQuantity: 10, unit: "EA" }],
    });
    const sourcingEvent = await sourcingService.createSourcingEvent(tenantAId, request.lines[0].id);
    const quote = await quoteService.submitQuote({
      tenantId: tenantAId,
      sourcingEventId: sourcingEvent.id,
      supplierId: supplier.id,
      productId: product.id,
      quotedQuantity: 10,
      unit: "EA",
      unitPrice: 5,
      currency: "EUR",
    });
    expect(quote.versions[0].productId).toBe(product.id);
  });
});
