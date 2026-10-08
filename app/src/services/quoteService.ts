import { tenantScoped } from "../db/client";
import { NotFoundError, ValidationError } from "../domain/errors";
import {
  requireId,
  requirePositiveDecimal,
  requireUnit,
  requireCurrency,
  requireOptionalPositiveInt,
  requireOptionalIsoDate,
  requireOptionalBoundedString,
} from "../domain/validation";

// The real tenantScoped() client type (never a hand-rolled structural
// subset) — submitQuote's return type is inferred from this, and a
// narrower type here would silently widen/weaken that inference for
// every caller. AI-1 (quoteDocumentService.confirmExtraction) needs
// submitQuote to run inside an existing `$transaction` callback; see
// that call site's own comment for why a cast, not a type change here,
// is how that is bridged.
type QuoteServiceDb = ReturnType<typeof tenantScoped>;

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
  // AI-1 (docs/decisions/ratified.md): optional, displayed-only fields —
  // never read by recommendationService.ts in V1.
  leadTimeDays?: number;
  paymentTermDays?: number;
  validUntil?: string;
  incoterm?: string;
}

export async function submitQuote(input: SubmitQuoteInput, dbOverride?: QuoteServiceDb) {
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
  const leadTimeDays = requireOptionalPositiveInt(input.leadTimeDays, "leadTimeDays");
  const paymentTermDays = requireOptionalPositiveInt(input.paymentTermDays, "paymentTermDays");
  const validUntil = requireOptionalIsoDate(input.validUntil, "validUntil");
  const incoterm = requireOptionalBoundedString(input.incoterm, "incoterm", 16);
  const db = dbOverride ?? tenantScoped(tenantId);

  const sourcingEvent = await db.sourcingEvent.findFirst({
    where: { id: sourcingEventId, tenantId },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", sourcingEventId);
  }

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier", supplierId);
  }

  const product = await db.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) {
    throw new NotFoundError("Product", productId);
  }

  return db.supplierQuote.create({
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
          leadTimeDays,
          paymentTermDays,
          validUntil,
          incoterm,
        },
      },
    },
    include: { versions: true },
  });
}

export async function listQuoteVersionsForSourcingEvent(tenantId: string, sourcingEventId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
  const db = tenantScoped(validTenantId);

  return db.quoteVersion.findMany({
    where: {
      tenantId: validTenantId,
      supplierQuote: { sourcingEventId: validSourcingEventId },
    },
    include: { supplierQuote: { include: { supplier: true } } },
  });
}
