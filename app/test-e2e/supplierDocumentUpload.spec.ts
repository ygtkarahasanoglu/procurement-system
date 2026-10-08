import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createSession } from "../src/api/session";
import { createRFQDispatch, issueResponseToken } from "../src/services/rfqDispatchService";

// AI-1 (docs/decisions/ratified.md) — Commit 4: supplier document
// upload via the RFQ response link, real-browser E2E. Same conventions
// as rfqUi.spec.ts (real backend API + real PostgreSQL); issues its own
// fresh token directly via issueResponseToken, for the identical reason
// rfqUi.spec.ts's own comment explains (the raw token is never
// observable from outside EmailSender.send by design).
const prisma = new PrismaClient();
const TENANT_NAME = `Playwright AI-1 Supplier Doc Tenant ${Date.now()}`;

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

test.describe("Supplier document upload via the RFQ response link (AI-1, Commit 4)", () => {
  let tenantId: string;
  let procurementUserId: string;
  let sourcingEventId: string;
  let supplierId: string;

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, name: "AI-1 Supplier Doc E2E User", role: "procurement_user" } });
    procurementUserId = user.id;
    const product = await prisma.product.create({ data: { tenantId, name: "AI-1 Supplier Doc Product", sku: "AI1-SDU" } });
    const supplier = await prisma.supplier.create({ data: { tenantId, name: "AI-1 Supplier Doc Supplier", email: "sdu@example.com" } });
    supplierId = supplier.id;
    const request = await prisma.procurementRequest.create({ data: { tenantId, createdById: user.id } });
    const line = await prisma.requestLine.create({
      data: { tenantId, requestId: request.id, productId: product.id, requestedQuantity: "15", unit: "EA" },
    });
    const sourcingEvent = await prisma.sourcingEvent.create({ data: { tenantId, requestLineId: line.id } });
    sourcingEventId = sourcingEvent.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateAs(context, procurementUserId);
  });

  test("supplier uploads a document instead of filling the form; buyer sees it (FAILED, no provider) in the internal workflow", async ({
    page,
    browser,
  }) => {
    const dispatch = await createRFQDispatch(tenantId, sourcingEventId, supplierId);
    const { rawToken } = await issueResponseToken(tenantId, dispatch.id);

    // Fresh, fully unauthenticated browser context — no session cookie.
    const supplierContext = await browser.newContext();
    const supplierPage = await supplierContext.newPage();
    await supplierPage.goto(`/rfq-response/${rawToken}`);

    await expect(supplierPage.getByText(/AI-1 Supplier Doc Product — 15 EA requested/)).toBeVisible();

    const uploadButton = supplierPage.getByText("veya teklif dosyanızı yükleyin");
    await expect(uploadButton).toBeVisible();
    await supplierPage.locator('input[type="file"]').setInputFiles({
      name: "supplier-quote.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 supplier link e2e"),
    });

    await expect(supplierPage.getByText(/Thank you/)).toBeVisible();
    await supplierContext.close();

    // The token is now consumed — re-visiting the same link must behave
    // like any other already-used token (generic invalid/expired message).
    const secondAttempt = await browser.newContext();
    const secondPage = await secondAttempt.newPage();
    await secondPage.goto(`/rfq-response/${rawToken}`);
    await expect(secondPage.getByText(/invalid or has expired/)).toBeVisible();
    await secondAttempt.close();

    // Buyer side: open the workflow and find the uploaded document under
    // "Teklif belgesi yükleme" — FAILED, since the dev API runs with
    // AI_EXTRACTION_PROVIDER=none, exactly like the buyer-upload e2e test.
    await page.goto("/");
    const row = page.locator(".data-table tr", { hasText: "AI-1 Supplier Doc Product" });
    await row.getByRole("button", { name: "Open workflow →" }).click();

    const supplierRow = page.locator(".quote-document-upload-row", { hasText: "AI-1 Supplier Doc Supplier" });
    const review = supplierRow.locator(".quote-extraction-review");
    await expect(review).toContainText("FAILED");
    await expect(review).toContainText("supplier-quote.pdf");

    // Never a QuoteVersion from this upload alone — the Supplier Quotes
    // table must not show this supplier until a buyer confirms it.
    const quotesSection = page.locator("section.panel").filter({ hasText: "Supplier Quotes" });
    await expect(quotesSection.locator(".data-table")).toHaveCount(0);
  });
});
