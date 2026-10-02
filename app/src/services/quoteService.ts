import { prisma } from "../db/client";
import { NotFoundError, ValidationError } from "../domain/errors";
import { requireId, requirePositiveDecimal, requireUnit, requireCurrency } from "../domain/validation";

// RL-C4: a supplier may quote less than the requested quantity; this is
// not inherently invalid. This service imposes NO minimum relative to
// the Request Line's requestedQuantity.
//
// QuoteVersion is immutable once created (03-data-model.md) — this
// service only ever creates version 1 for a given SupplierQuote. There
// is no update/revise function for a QuoteVersion's commercial fields.
export interface SubmitQuoteInput {
  tenantId: string;
  sourcingEventId: string;
  supplierId: string;
  productId: string;
  quotedQuantity: string | number;
  unit: string;
  unitPrice: string | number;
  currency: string;
}

export async function submitQuote(input: SubmitQuoteInput) {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }

  const tenantId = requireId(input.tenantId, "tenantId");
  const sourcingEventId = requireId(input.sourcingEventId, "sourcingEventId");
  const supplierId = requireId(input.supplierId, "supplierId");
  const productId = requireId(input.productId, "productId");
  const quotedQuantity = requirePositiveDecimal(input.quotedQuantity, "quotedQuantity");
  const unit = requireUnit(input.unit);
  const unitPrice = requirePositiveDecimal(input.unitPrice, "unitPrice");
  const currency = requireCurrency(input.currency);

  const sourcingEvent = await prisma.sourcingEvent.findFirst({
    where: { id: sourcingEventId, tenantId },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", sourcingEventId);
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, tenantId },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier", supplierId);
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) {
    throw new NotFoundError("Product", productId);
  }

  return prisma.supplierQuote.create({
    data: {
      tenantId,
      sourcingEventId,
      supplierId,
      versions: {
        create: {
          tenantId,
          versionNumber: 1,
          productId,
          quotedQuantity,
          unit,
          unitPrice,
          currency,
        },
      },
    },
    include: { versions: true },
  });
}

export async function listQuoteVersionsForSourcingEvent(tenantId: string, sourcingEventId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");

  return prisma.quoteVersion.findMany({
    where: {
      tenantId: validTenantId,
      supplierQuote: { sourcingEventId: validSourcingEventId },
    },
    include: { supplierQuote: { include: { supplier: true } } },
  });
}
