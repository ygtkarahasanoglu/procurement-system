import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/client";
import * as requestService from "../src/services/requestService";
import * as sourcingService from "../src/services/sourcingService";
import * as quoteService from "../src/services/quoteService";
import * as recommendationService from "../src/services/recommendationService";
import * as decisionService from "../src/services/decisionService";
import * as approvalService from "../src/services/approvalService";
import * as purchaseOrderService from "../src/services/purchaseOrderService";
import { CommercialDeviationError, ApprovalRequiredError, NotFoundError } from "../src/domain/errors";

// End-to-end test of the V1 vertical slice, following exactly the
// ratified scenario:
//   Request: Product A, 100 EA
//   Supplier A quotes 100 EA x EUR 10; Supplier B quotes 80 EA x EUR 9.50
//   Deterministic AI recommendation: Supplier A, 100 EA (full coverage, lowest price among full-coverage quotes)
//   Human decision: Supplier A, 90 EA (revised down from the 100 EA recommendation — CR-C)
//   Frozen DecisionPackage: Supplier A, 90 EA x EUR 10
//   Approval: APPROVED
//   PurchaseOrder: Supplier A, Product A, 90 EA x EUR 10

async function resetDatabase() {
  await prisma.$transaction([
    prisma.purchaseOrder.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.decisionPackage.deleteMany(),
    prisma.recommendationRecord.deleteMany(),
    prisma.quoteVersion.deleteMany(),
    prisma.supplierQuote.deleteMany(),
    prisma.sourcingEvent.deleteMany(),
    prisma.requestLine.deleteMany(),
    prisma.procurementRequest.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.product.deleteMany(),
    prisma.user.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
}

describe("Procurement vertical slice E2E", () => {
  let tenantId: string;
  let procurementUserId: string;
  let approverUserId: string;
  let productAId: string;
  let supplierAId: string;
  let supplierBId: string;
  let requestLineId: string;
  let sourcingEventId: string;
  let quoteVersionAId: string;

  beforeAll(async () => {
    await resetDatabase();

    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant (automated test fixture)" } });
    tenantId = tenant.id;

    const procurementUser = await prisma.user.create({
      data: { tenantId, name: "Test Procurement User", role: "procurement_user" },
    });
    procurementUserId = procurementUser.id;

    const approverUser = await prisma.user.create({
      data: { tenantId, name: "Test Approver", role: "approver" },
    });
    approverUserId = approverUser.id;

    const productA = await prisma.product.create({
      data: { tenantId, name: "Product A (test fixture)", sku: "TEST-PRODUCT-A" },
    });
    productAId = productA.id;

    const supplierA = await prisma.supplier.create({ data: { tenantId, name: "Supplier A (test fixture)" } });
    supplierAId = supplierA.id;

    const supplierB = await prisma.supplier.create({ data: { tenantId, name: "Supplier B (test fixture)" } });
    supplierBId = supplierB.id;
  });

  it("Test 1 — creates a ProcurementRequest with a RequestLine for Product A, 100 EA", async () => {
    const request = await requestService.createRequest({
      tenantId,
      createdById: procurementUserId,
      lines: [{ productId: productAId, requestedQuantity: 100, unit: "EA" }],
    });

    expect(request.lines).toHaveLength(1);
    expect(Number(request.lines[0].requestedQuantity)).toBe(100);
    expect(request.lines[0].unit).toBe("EA");
    requestLineId = request.lines[0].id;

    const sourcingEvent = await sourcingService.createSourcingEvent(tenantId, requestLineId);
    sourcingEventId = sourcingEvent.id;
  });

  it("Test 2 — accepts quotes from Supplier A (100 EA x 10) and Supplier B (80 EA x 9.50)", async () => {
    const quoteA = await quoteService.submitQuote({
      tenantId,
      sourcingEventId,
      supplierId: supplierAId,
      productId: productAId,
      quotedQuantity: 100,
      unit: "EA",
      unitPrice: 10,
      currency: "EUR",
    });
    quoteVersionAId = quoteA.versions[0].id;

    const quoteB = await quoteService.submitQuote({
      tenantId,
      sourcingEventId,
      supplierId: supplierBId,
      productId: productAId,
      quotedQuantity: 80,
      unit: "EA",
      unitPrice: 9.5,
      currency: "EUR",
    });

    expect(Number(quoteA.versions[0].quotedQuantity)).toBe(100);
    expect(Number(quoteB.versions[0].quotedQuantity)).toBe(80);

    const versions = await quoteService.listQuoteVersionsForSourcingEvent(tenantId, sourcingEventId);
    expect(versions).toHaveLength(2);
  });

  it("Test 3 — deterministic AI recommendation recommends Supplier A, 100 EA (full coverage, lowest price)", async () => {
    const recommendation = await recommendationService.generateRecommendation(tenantId, sourcingEventId);

    expect(recommendation.isDeterministicTestProvider).toBe(true);
    expect(recommendation.providerName).toBe("deterministic-test-provider-v1");
    expect(recommendation.recommendedQuoteVersionId).toBe(quoteVersionAId);
    expect(Number(recommendation.recommendedQuantity)).toBe(100);
  });

  let decisionPackageId: string;

  it("Test 4 — human revises the recommended 100 EA down to 90 EA and freezes the DecisionPackage", async () => {
    const draft = await decisionService.formDecision({
      tenantId,
      sourcingEventId,
      sourceQuoteVersionId: quoteVersionAId,
      selectedQuantity: 90, // human revision: AI recommended 100, human selects 90 (CR-C)
      createdById: procurementUserId,
    });
    expect(draft.status).toBe("DRAFT");
    expect(Number(draft.selectedQuantity)).toBe(90);

    const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
    decisionPackageId = frozen.id;

    expect(frozen.status).toBe("FROZEN");
    expect(Number(frozen.selectedQuantity)).toBe(90); // NOT 100 — proves CR-C's boundary
    expect(Number(frozen.unitPrice)).toBe(10);
    expect(frozen.currency).toBe("EUR");
  });

  let approvalId: string;

  it("Test 5 — approves the frozen DecisionPackage", async () => {
    const approval = await approvalService.approve(tenantId, decisionPackageId, approverUserId);
    approvalId = approval.id;

    expect(approval.status).toBe("APPROVED");
    expect(approval.decisionPackageId).toBe(decisionPackageId);
  });

  it("Test 6 — creates the PurchaseOrder from the approved decision: Supplier A, Product A, 90 EA, 10 EUR", async () => {
    const po = await purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approvalId, procurementUserId);

    expect(po.supplierId).toBe(supplierAId);
    expect(po.productId).toBe(productAId);
    expect(Number(po.quantity)).toBe(90);
    expect(po.unit).toBe("EA");
    expect(Number(po.unitPrice)).toBe(10);
    expect(po.currency).toBe("EUR");
  });

  it("Test 7 — rejects PO creation when no valid Approval exists (APO-D1 gate)", async () => {
    // A DecisionPackage that exists and is frozen, but has never been approved.
    const draft = await decisionService.formDecision({
      tenantId,
      sourcingEventId,
      sourceQuoteVersionId: quoteVersionAId,
      selectedQuantity: 90,
      createdById: procurementUserId,
    });
    await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);

    // There is no Approval for this DecisionPackage. The PO service only
    // accepts an Approval id, so simulate the rejected attempt with a
    // fabricated id that does not correspond to any Approval row.
    const nonExistentApprovalId = randomUUID();

    await expect(
      purchaseOrderService.createPurchaseOrderFromApproval(tenantId, nonExistentApprovalId, procurementUserId)
    ).rejects.toThrow(ApprovalRequiredError);
  });

  it("Test 8 — rejects an attempt to create a PO for 80 EA from an Approval for 90 EA (CT-A1 / CR-A / CR-B.2 / Q3)", async () => {
    // Fresh decision/approval pair so the deviation check — not the
    // one-PO-per-Approval check — is what fires.
    const draft = await decisionService.formDecision({
      tenantId,
      sourcingEventId,
      sourceQuoteVersionId: quoteVersionAId,
      selectedQuantity: 90,
      createdById: procurementUserId,
    });
    const frozen = await decisionService.freezeDecisionPackage(tenantId, draft.id, procurementUserId);
    const approval = await approvalService.approve(tenantId, frozen.id, approverUserId);

    await expect(
      purchaseOrderService.createPurchaseOrderFromApproval(tenantId, approval.id, procurementUserId, { quantity: 80 })
    ).rejects.toThrow(CommercialDeviationError);

    // The approved decision itself must remain untouched by the rejected attempt.
    const stillFrozen = await prisma.decisionPackage.findUniqueOrThrow({ where: { id: frozen.id } });
    expect(Number(stillFrozen.selectedQuantity)).toBe(90);

    // No PO must have been created as a side effect of the rejected attempt.
    const po = await prisma.purchaseOrder.findUnique({ where: { approvalId: approval.id } });
    expect(po).toBeNull();
  });

  it("Test 9 — rejects cross-tenant access to another tenant's Approval", async () => {
    const otherTenant = await prisma.tenant.create({ data: { name: "Other Tenant (test fixture)" } });
    const otherUser = await prisma.user.create({
      data: { tenantId: otherTenant.id, name: "Other Tenant User", role: "procurement_user" },
    });

    // approvalId belongs to tenantId (Test 6's approval); attempting to
    // use it under otherTenant's id must behave as if it does not exist.
    await expect(
      purchaseOrderService.createPurchaseOrderFromApproval(otherTenant.id, approvalId, otherUser.id)
    ).rejects.toThrow(ApprovalRequiredError);

    // Likewise, the acting user must be resolved within the claimed tenant.
    await expect(approvalService.approve(otherTenant.id, decisionPackageId, approverUserId)).rejects.toThrow(
      NotFoundError
    );

    await prisma.user.delete({ where: { id: otherUser.id } });
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});
