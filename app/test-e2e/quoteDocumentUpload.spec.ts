import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createSession } from "../src/api/session";

// AI-1 (docs/decisions/ratified.md) — real-browser E2E for the buyer
// document-upload UI (Commit 3), against the real dev server/database.
// The dev API is assumed to be running with AI_EXTRACTION_PROVIDER=none
// (its default) — so this exercises the deterministic FAILED path (no
// AI call), exactly like every other automated test in this repo. The
// real Gemini path is only ever exercised manually, via
// `npm run smoke:extract`.
const prisma = new PrismaClient();
const TENANT_NAME = `Playwright AI-1 Tenant ${Date.now()}`;

async function authenticateAs(context: BrowserContext, userId: string): Promise<void> {
  const session = await createSession(userId);
  await context.addCookies([
    {
      name: "session",
      value: session.rawToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(session.expiresAt.getTime() / 1000),
    },
  ]);
}

test.describe("Quote document upload + AI extraction review (AI-1, Commit 3)", () => {
  let tenantId: string;
  let procurementUserId: string;
  let requestLineId: string;
  let supplierAId: string;

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, name: "AI-1 E2E User", role: "procurement_user" } });
    procurementUserId = user.id;
    const product = await prisma.product.create({ data: { tenantId, name: "AI-1 Product", sku: "AI1-PRODUCT" } });
    const supplierA = await prisma.supplier.create({ data: { tenantId, name: "AI-1 Supplier A" } });
    supplierAId = supplierA.id;

    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "20", unit: "EA" },
    });
    requestLineId = line.id;
    await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateAs(context, procurementUserId);
  });

  test("uploading a document with no AI provider configured shows FAILED and the normal manual form still works", async ({
    page,
  }) => {
    await page.goto("/");

    const row = page.locator(".data-table tr", { hasText: "AI-1 Product" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Open workflow →" }).click();

    await expect(page.getByText(/is OPEN/)).toBeVisible();
    await expect(page.getByText("Teklif belgesi yükleme")).toBeVisible();

    const supplierRow = page.locator(".quote-document-upload-row", { hasText: "AI-1 Supplier A" });
    await expect(supplierRow).toBeVisible();

    await supplierRow.locator('input[type="file"]').setInputFiles({
      name: "quote.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fake test content for AI-1 e2e"),
    });

    const review = supplierRow.locator(".quote-extraction-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("FAILED");
    await expect(review).toContainText("AI extraction not configured");
    await expect(review.locator("a")).toHaveText("quote.pdf");
    // FAILED never shows the review/confirm form.
    await expect(review.locator("form")).toHaveCount(0);

    // The ordinary manual QuoteForm, with the 4 new AI-1 fields, still
    // works exactly as before.
    const form = page.locator(".quote-form").last();
    await form.locator("select").selectOption({ label: "AI-1 Supplier A" });
    await form.getByPlaceholder("Qty").fill("20");
    await form.getByPlaceholder("Unit", { exact: true }).fill("EA");
    await form.getByPlaceholder("Unit price").fill("15");
    await form.getByPlaceholder("Currency").fill("EUR");
    await form.getByPlaceholder("Lead time (days)").fill("7");
    await form.getByPlaceholder("Payment term (days)").fill("30");
    await form.getByPlaceholder("Incoterm").fill("fob");
    await form.getByRole("button", { name: "Submit Quote" }).click();

    const quoteTable = page.locator(".data-table", { hasText: "Lead time" });
    await expect(quoteTable).toContainText("AI-1 Supplier A");
    await expect(quoteTable).toContainText("7d");
    await expect(quoteTable).toContainText("30d");
    await expect(quoteTable).toContainText("FOB");
  });
});
