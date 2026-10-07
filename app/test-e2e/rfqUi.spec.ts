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

  // RFQ-RT1-RFQ-RT5 (docs/decisions/ratified.md) — same-dispatch retry
  // and new-dispatch resend UI semantics. Each test forces the specific
  // dispatch state it needs via Prisma directly, mirroring this file's
  // own existing issueResponseToken precedent (above): the real SEND
  // outcome against whichever EmailSender this environment happens to
  // have configured is not relied on to produce a deterministic starting
  // state, only the terminal outcome of an actual click is ever left
  // unassumed.
  async function reopenWorkflow(page: import("@playwright/test").Page, quantityText: string) {
    await page.getByRole("button", { name: "← Back to requests" }).click();
    // Matches the Requested Qty cell's exact text, not a substring of the
    // row — the Request/Line columns render truncated hex UUID fragments
    // (RequestList.tsx), which can otherwise coincidentally contain the
    // same two digits as a quantity used here.
    await page
      .locator(".data-table tbody tr")
      .filter({ has: page.locator("td", { hasText: new RegExp(`^${quantityText}$`) }) })
      .getByRole("button", { name: "Open workflow →" })
      .click();
  }

  test("Retry: a SEND_FAILED dispatch shows Retry, and clicking it continues the same dispatch's lifecycle", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("61");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SEND_FAILED" } });

    await reopenWorkflow(page, "61");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    const row = rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" });
    await expect(row.locator(".badge")).toHaveText("SEND_FAILED");

    const retryButton = row.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();
    await retryButton.click();

    await expect(row).toBeVisible();
    const statusText = (await row.locator(".badge").textContent())?.trim();
    expect(["SENT", "SEND_FAILED"]).toContain(statusText);

    // Same dispatch id throughout — retry never creates a second row.
    const totalForSupplier = await prisma.rFQDispatch.count({
      where: { tenantId, supplierId, sourcingEventId: dispatch.sourcingEventId },
    });
    expect(totalForSupplier).toBe(1);
  });

  test("Retry: a SENDING dispatch never shows a Retry action", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("62");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENDING" } });

    await reopenWorkflow(page, "62");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    const row = rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" });
    await expect(row.locator(".badge")).toHaveText("SENDING");
    await expect(row.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("Resend: selecting a supplier with a SENDING dispatch shows a blocking duplicate-risk confirmation; Cancel makes no API calls and leaves dispatches unchanged", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("63");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENDING" } });

    await reopenWorkflow(page, "63");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });

    const beforeCount = await prisma.rFQDispatch.count({ where: { tenantId, supplierId, sourcingEventId: dispatch.sourcingEventId } });

    let dialogMessage = "";
    page.once("dialog", async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();

    await expect.poll(() => dialogMessage).not.toBe("");
    expect(dialogMessage).toMatch(/SENDING/);
    expect(dialogMessage).toMatch(/duplicate/i);

    const afterCount = await prisma.rFQDispatch.count({ where: { tenantId, supplierId, sourcingEventId: dispatch.sourcingEventId } });
    expect(afterCount).toBe(beforeCount);
    const unchangedOriginal = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(unchangedOriginal.status).toBe("SENDING");
  });

  test("Resend: Continue on the duplicate-risk confirmation creates a new, independent RFQDispatch and sends it, leaving the old SENDING row unchanged", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("64");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const originalDispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: originalDispatch.id }, data: { status: "SENDING" } });

    await reopenWorkflow(page, "64");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();

    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toHaveCount(2);

    const unchangedOriginal = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: originalDispatch.id } });
    expect(unchangedOriginal.status).toBe("SENDING");

    const allForSupplier = await prisma.rFQDispatch.findMany({
      where: { tenantId, supplierId, sourcingEventId: originalDispatch.sourcingEventId },
    });
    expect(allForSupplier).toHaveLength(2);
    const newDispatch = allForSupplier.find((d) => d.id !== originalDispatch.id);
    expect(newDispatch).toBeDefined();
    expect(["PENDING", "SENDING", "SENT", "SEND_FAILED"]).toContain(newDispatch!.status);
  });

  test("Resend: no mandatory confirmation when the supplier's only existing dispatch is SEND_FAILED (not SENDING)", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("65");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SEND_FAILED" } });

    await reopenWorkflow(page, "65");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });

    let dialogFired = false;
    page.on("dialog", async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();

    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toHaveCount(2);
    expect(dialogFired).toBe(false);
  });

  test("Resend: no mandatory confirmation when the supplier's only existing dispatch is SENT (not SENDING); the existing generic create+send path still works and the old SENT dispatch is unchanged", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Product").selectOption({ label: "RFQ UI Product (RFQUI-SKU)" });
    await page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity").fill("66");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();

    let rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });
    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();
    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toBeVisible();

    const dispatch = await prisma.rFQDispatch.findFirstOrThrow({
      where: { tenantId, supplierId },
      orderBy: { createdAt: "desc" },
    });
    await prisma.rFQDispatch.update({ where: { id: dispatch.id }, data: { status: "SENT" } });

    await reopenWorkflow(page, "66");
    rfqSection = page.locator("section.panel").filter({ hasText: "Request for Quote (RFQ)" });

    let dialogFired = false;
    page.on("dialog", async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await rfqSection.locator(".rfq-send-form select").selectOption({ label: "RFQ UI Supplier" });
    await rfqSection.getByRole("button", { name: "Send RFQ" }).click();

    await expect(rfqSection.locator(".data-table tbody tr").filter({ hasText: "RFQ UI Supplier" })).toHaveCount(2);
    expect(dialogFired).toBe(false);

    const unchangedOriginal = await prisma.rFQDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(unchangedOriginal.status).toBe("SENT");
  });
});
