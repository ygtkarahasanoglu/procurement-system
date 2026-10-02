import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Real-browser E2E test of the UI vertical slice, against the real
// backend API and a real PostgreSQL database (the dev database the API
// server under test is actually running against — NOT the vitest
// `procurement_test` database, since this exercises the running dev
// server, not an in-process call). This test creates its own isolated
// Tenant/User/Product/Supplier fixtures (there is no UI for creating
// those — see README "Tenant / actor handling": the brief treats
// tenants/users/products/suppliers as pre-existing, seed-created
// fixtures, not something the UI creates) so it never collides with
// whatever `npm run db:seed` has already created.
const prisma = new PrismaClient();
// Unique per run so `selectOption({ label })` in the browser unambiguously
// targets this run's own tenant, even if a previous run's fixtures (or
// `npm run db:seed`'s own demo tenant) are still present in the database.
const TENANT_NAME = `Playwright E2E Tenant ${Date.now()}`;

test.describe("Full procurement workflow via the browser", () => {
  let tenantId: string;
  let productAId: string;
  let supplierAId: string;
  let supplierBId: string;

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
    tenantId = tenant.id;
    await prisma.user.create({ data: { tenantId, name: "E2E Procurement User", role: "procurement_user" } });
    await prisma.user.create({ data: { tenantId, name: "E2E Approver", role: "approver" } });
    const product = await prisma.product.create({ data: { tenantId, name: "Product A", sku: "E2E-PRODUCT-A" } });
    productAId = product.id;
    const supplierA = await prisma.supplier.create({ data: { tenantId, name: "Supplier A" } });
    supplierAId = supplierA.id;
    const supplierB = await prisma.supplier.create({ data: { tenantId, name: "Supplier B" } });
    supplierBId = supplierB.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("Request 100 EA -> quotes -> recommendation 100 -> human decision 90 -> freeze -> approve -> PO 90", async ({ page }) => {
    await page.goto("/");

    // --- Tenant / actor selection ---
    await page.getByLabel("Tenant").selectOption({ label: TENANT_NAME });
    await page.getByLabel("Acting as").selectOption({ label: "E2E Procurement User (procurement_user)" });

    // --- 1. Create Request: Product A, 100 EA ---
    await page.getByLabel("Product").selectOption({ label: "Product A (E2E-PRODUCT-A)" });
    const quantityInput = page.locator(".panel").filter({ hasText: "New Procurement Request" }).getByLabel("Quantity");
    await quantityInput.fill("100");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();

    await expect(page.getByText(/Product A — 100 EA requested/)).toBeVisible();

    // --- 2. Open Sourcing Event ---
    await page.getByRole("button", { name: "Open Sourcing Event" }).click();
    await expect(page.getByText(/is OPEN/)).toBeVisible();

    // --- 3. Supplier A quote: 100 EA x EUR 10 ---
    await submitQuote(page, { supplier: "Supplier A", qty: "100", unit: "EA", price: "10", currency: "EUR" });
    await expect(page.locator(".data-table")).toContainText("Supplier A");

    // --- 4. Supplier B quote: 80 EA x EUR 9.50 ---
    await submitQuote(page, { supplier: "Supplier B", qty: "80", unit: "EA", price: "9.5", currency: "EUR" });
    await expect(page.locator(".data-table")).toContainText("Supplier B");

    // --- 5. Generate AI Recommendation: expect Supplier A, 100 EA ---
    await page.getByRole("button", { name: "Generate Recommendation" }).click();
    const recommendationCard = page.locator(".value-card--recommendation");
    await expect(recommendationCard).toContainText("Supplier A");
    await expect(recommendationCard).toContainText("100 EA");
    await expect(page.getByText(/AI Recommendation/).first()).toBeVisible();
    // The recommendation must never be labeled as approved anywhere near it.
    await expect(recommendationCard).not.toContainText("Approved");

    // --- 6. Human Decision Formation: base on Supplier A's quote, but select 90 ---
    const decisionSection = page.locator("section.panel").filter({ hasText: "Human Decision Formation" });
    await decisionSection.getByRole("combobox").selectOption({ label: "Supplier A — 100 EA × 10 EUR" });
    const decisionQtyInput = decisionSection.locator('input[type="number"]');
    await expect(decisionQtyInput).toHaveValue("100"); // prefilled from the quote, not silently forced to the recommendation
    await decisionQtyInput.fill("90");
    await decisionSection.getByRole("button", { name: "Form Decision" }).click();

    await expect(decisionSection.locator(".value-card")).toContainText("90 EA");
    await expect(decisionSection.locator(".value-card")).toContainText("DRAFT");

    // --- 7. Freeze the decision at 90 ---
    await decisionSection.getByRole("button", { name: "Freeze Decision" }).click();
    await expect(decisionSection.locator(".value-card")).toContainText("FROZEN");
    await expect(decisionSection.locator(".value-card")).toContainText("90 EA");
    // Editing controls must be gone once frozen.
    await expect(decisionSection.getByRole("button", { name: "Freeze Decision" })).toHaveCount(0);
    await expect(decisionSection.locator('input[type="number"]')).toHaveCount(0);

    // --- 8. Approval requires an approver actor; switch actor ---
    await page.getByLabel("Acting as").selectOption({ label: "E2E Approver (approver)" });
    const approvalSection = page.locator("section.panel").filter({ hasText: "Approval" });
    await expect(approvalSection.locator(".value-card")).toContainText("90 EA"); // frozen decision shown before approving
    await approvalSection.getByRole("button", { name: "Approve" }).click();
    await expect(approvalSection.getByText("APPROVED")).toBeVisible();

    // --- 9. Create Purchase Order (no commercial fields entered) ---
    const poSection = page.locator("section.panel").filter({ hasText: "Purchase Order" });
    await expect(poSection.getByRole("button", { name: "Create Purchase Order" })).toBeVisible();
    // Confirm there is no input of any kind for commercial values in this section.
    await expect(poSection.locator("input")).toHaveCount(0);
    await poSection.getByRole("button", { name: "Create Purchase Order" }).click();

    await expect(poSection.locator(".value-card--po")).toContainText("Supplier A");
    await expect(poSection.locator(".value-card--po")).toContainText("90 EA");
    await expect(poSection.locator(".value-card--po")).toContainText("10 EUR");
    // The PO must display 90, never the AI's original 100.
    await expect(poSection.locator(".value-card--po")).not.toContainText("100 EA");
  });

  test("PO action is unavailable before an Approval exists", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Tenant").selectOption({ label: TENANT_NAME });
    await page.getByLabel("Acting as").selectOption({ label: "E2E Procurement User (procurement_user)" });

    await page.getByLabel("Product").selectOption({ label: "Product A (E2E-PRODUCT-A)" });
    await page
      .locator(".panel")
      .filter({ hasText: "New Procurement Request" })
      .getByLabel("Quantity")
      .fill("50");
    await page.getByLabel("Unit").fill("EA");
    await page.getByRole("button", { name: "Create Request" }).click();

    await page.getByRole("button", { name: "Open Sourcing Event" }).click();
    await submitQuote(page, { supplier: "Supplier A", qty: "50", unit: "EA", price: "20", currency: "EUR" });

    // No Approval section/PO section should be rendered at all yet — the
    // UI only shows the "Create Purchase Order" action once an Approval
    // exists in the data the backend returned, never as a disabled
    // placeholder a user could be tempted to force.
    await expect(page.getByRole("button", { name: "Create Purchase Order" })).toHaveCount(0);
    await expect(page.locator("section.panel").filter({ hasText: "Approval" })).toHaveCount(0);
  });

  test("Backend errors are displayed cleanly, never as a stack trace", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Tenant").selectOption({ label: TENANT_NAME });
    await page.getByLabel("Acting as").selectOption({ label: "E2E Procurement User (procurement_user)" });

    await page.getByRole("button", { name: "Create Request" }).click(); // no product selected

    const banner = page.locator(".error-banner, .form-error");
    await expect(banner.first()).toBeVisible();
    const text = (await banner.first().textContent()) ?? "";
    expect(text).not.toMatch(/at Object\.|at Module\._compile|node_modules|PrismaClient/);
  });
});

async function submitQuote(
  page: import("@playwright/test").Page,
  input: { supplier: string; qty: string; unit: string; price: string; currency: string }
) {
  const form = page.locator(".quote-form");
  await form.locator("select").selectOption({ label: input.supplier });
  await form.getByPlaceholder("Qty").fill(input.qty);
  await form.getByPlaceholder("Unit", { exact: true }).fill(input.unit);
  await form.getByPlaceholder("Unit price").fill(input.price);
  await form.getByPlaceholder("Currency").fill(input.currency);
  await form.getByRole("button", { name: "Submit Quote" }).click();
}
