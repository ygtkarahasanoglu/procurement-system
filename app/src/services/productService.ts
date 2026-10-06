import { tenantScoped } from "../db/client";
import { requireId, requireNonEmptyString } from "../domain/validation";

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
