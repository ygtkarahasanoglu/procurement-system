import { tenantScoped } from "../db/client";
import { requireId, requireNonEmptyString } from "../domain/validation";
import { NotFoundError } from "../domain/errors";

// Exposes creation of the existing flat Product reference (name, sku)
// already in schema.prisma — not a product identity/master-data
// subsystem. PI-C1-PI-C11 (category-specific identity, attribute sets,
// packaging, etc.) are neither implemented nor assumed here. No
// uniqueness is enforced on sku: the schema has none today, and this
// function preserves that rather than inventing a new constraint.
export async function createProduct(tenantId: string, name: string, sku: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validName = requireNonEmptyString(name, "name");
  const validSku = requireNonEmptyString(sku, "sku");
  const db = tenantScoped(validTenantId);
  return db.product.create({ data: { tenantId: validTenantId, name: validName, sku: validSku } });
}

// Corrects ordinary data-entry mistakes (name/sku) on an already-existing
// Product. Same non-decision as createProduct above: no identity/
// matching semantics, no uniqueness constraint. The atomic conditional
// update (updateMany with tenantId in `where`, then findUniqueOrThrow)
// mirrors decisionService.ts's existing freeze/revise pattern exactly —
// a cross-tenant or nonexistent productId is rejected identically
// (NotFoundError), never distinguished, never updateable.
export async function updateProduct(tenantId: string, productId: string, name: string, sku: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validProductId = requireId(productId, "productId");
  const validName = requireNonEmptyString(name, "name");
  const validSku = requireNonEmptyString(sku, "sku");
  const db = tenantScoped(validTenantId);

  const result = await db.product.updateMany({
    where: { id: validProductId, tenantId: validTenantId },
    data: { name: validName, sku: validSku },
  });
  if (result.count === 0) {
    throw new NotFoundError("Product", validProductId);
  }

  return db.product.findUniqueOrThrow({ where: { id: validProductId } });
}
