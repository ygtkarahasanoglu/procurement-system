import { prisma } from "../db/client";

// DEVELOPMENT / TEST FIXTURE DATA ONLY.
// Names and values below are placeholders chosen to be obviously
// synthetic ("Demo Tenant", "Product A", "Supplier A/B") and must never
// be mistaken for real customer, product, or supplier data.
async function main() {
  const tenant = await prisma.tenant.create({
    data: { name: "Demo Tenant (dev fixture)" },
  });

  const procurementUser = await prisma.user.create({
    data: { tenantId: tenant.id, name: "Demo Procurement User", role: "procurement_user" },
  });

  const approverUser = await prisma.user.create({
    data: { tenantId: tenant.id, name: "Demo Approver", role: "approver" },
  });

  const productA = await prisma.product.create({
    data: { tenantId: tenant.id, name: "Product A (demo fixture)", sku: "DEMO-PRODUCT-A" },
  });

  const supplierA = await prisma.supplier.create({
    data: { tenantId: tenant.id, name: "Supplier A (demo fixture)" },
  });

  const supplierB = await prisma.supplier.create({
    data: { tenantId: tenant.id, name: "Supplier B (demo fixture)" },
  });

  const request = await prisma.procurementRequest.create({
    data: {
      tenantId: tenant.id,
      createdById: procurementUser.id,
      lines: {
        create: [
          {
            tenantId: tenant.id,
            productId: productA.id,
            requestedQuantity: "100",
            unit: "EA",
          },
        ],
      },
    },
    include: { lines: true },
  });

  console.log("Seed complete. IDs for manual exploration:");
  console.log({
    tenantId: tenant.id,
    procurementUserId: procurementUser.id,
    approverUserId: approverUser.id,
    productAId: productA.id,
    supplierAId: supplierA.id,
    supplierBId: supplierB.id,
    requestId: request.id,
    requestLineId: request.lines[0].id,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
