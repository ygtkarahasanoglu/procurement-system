import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createSession } from "../src/api/session";
import { issueResponseToken } from "../src/services/rfqDispatchService";

// RFQ UI End-to-End V1 — real-browser E2E, same conventions as
// workflow.spec.ts (real backend API + real PostgreSQL, no mocks). Does
// NOT depend on RFQ_DEV_EMAIL_CAPTURE being set on the running `dev:api`
// process: the internal "Send RFQ" flow is exercised for real (and its
// resulting status — SENT or SEND_FAILED depending on whether a real/dev
// EmailSender is configured — is asserted as either, never assumed), but
// the supplier-facing half of this test issues its own fresh token
// directly via the already-exported issueResponseToken, in-process. This
// is necessary because the raw token the UI's own SEND attempt generates
// internally is never observable from outside EmailSender.send by
// design (RFQ-R1-R5) — it is NOT a workaround for a missing feature, and
// it exercises the identical, real, already-ratified token-issuance
// rotation mechanic (docs/decisions/open.md).
const prisma = new PrismaClient();
const TENANT_NAME = `Playwright RFQ UI Tenant ${Date.now()}`;

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

test.describe("RFQ UI End-to-End V1", () => {
  let tenantId: string;
  let procurementUserId: string;
  let supplierId: string;

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, name: "RFQ UI E2E User", role: "procurement_user" } });
    procurementUserId = user.id;
    await prisma.product.create({ data: { tenantId, name: "RFQ UI Product", sku: "RFQUI-SKU" } });
    const supplier = await prisma.supplier.create({
      data: { tenantId, name: "RFQ UI Supplier", email: "rfqui-supplier@example.com" },
    });
    supplierId = supplier.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateAs(context, procurementUserId);
  });

  test("Internal: create request -> open sourcing event -> Send RFQ produces a dispatch row with a real (never fabricated) status", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("25");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await expect(page.getByText(/RFQ UI Product — 25 EA requested/)).toBeVisible();

    await page.getByRole("button", { name: "Open Sourcing Event" }).click();
    await expect(page.getByText(/is OPEN/)).toBeVisible();

    const rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await expect(rfqSection.getByText(/provider is configured yet/)).toBeVisible();
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();

    const row = rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" });
    await expect(row).toBeVisible();
    const statusText = (await row.locator(".badge").textContent())?.trim();
    expect(["SENT", "SEND_FAILED"]).toContain(statusText);
  });

  test("Supplier: an unauthenticated browser can open the response link, see context, and submit — the response appears back in the internal workflow", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("40");
    await page.getByLabel("Unit").fill("KG");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    const rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    const { rawToken } = await issueResponseToken(tenantId, dispatch.id);

    // Fresh, fully unauthenticated browser context — no session cookie at
    // all — proving SupplierResponsePage never depends on one.
    const supplierContext = await browser.newContext();
    const supplierPage = await supplierContext.newPage();
    await supplierPage.goto(`/rfq-response/${rawToken}`);

    await expect(supplierPage.getByText(/RFQ UI Product — 40 KG requested/)).toBeVisible();

    const form = supplierPage.locator(".quote-form");
    await form.getByPlaceholder("Qty").fill("40");
    await form.getByPlaceholder("Unit", { exact: true }).fill("KG");
    await form.getByPlaceholder("Unit price").fill("12.5");
    await form.getByPlaceholder("Currency").fill("USD");
    await form.getByRole("button", { name: "Submit Response" }).click();

    await expect(supplierPage.getByText(/Thank you/)).toBeVisible();
    await supplierContext.close();

    // Re-fetch via the app's own navigation, not a full page reload —
    // openLineId is local React state (App.tsx), not URL-based, so a
    // browser reload would lose it and land back on the request list.
    await page.getByRole("button", { name: "← Back to requests" }).click();
    await page
      .locator(".data-table tbody tr")
      .filter({ hasText: "40" })
      .getByRole("button", { name: "Open workflow →" })
      .click();

    const quotesSection = page.locator("section.panel").filter({ hasText: "Supplier Quotes" });
    await expect(quotesSection.locator(".data-table")).toContainText("RFQ UI Supplier");
    await expect(quotesSection.locator(".data-table")).toContainText("USD");

    const updatedRow = page
      .locator("section.panel")
      .filter({ hasText: "Request for Quote (RFQ)" })
      .locator(".data-table tbody tr")
      .filter({ hasText: "RFQ UI Supplier" });
    await expect(updatedRow).not.toContainText("—"); // "Responded" column is no longer the empty placeholder
  });

  test("Supplier: an invalid token shows a generic message, never a stack trace or enumeration detail", async ({ page }) => {
    await page.goto("/rfq-response/not-a-real-token");
    await expect(page.getByText(/invalid or has expired/)).toBeVisible();
    const text = await page.locator(".app-main").textContent();
    expect(text).not.toMatch(/at Object\.|node_modules|PrismaClient|NotFoundError/);
  });
});
