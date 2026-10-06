import { tenantScoped } from "../db/client";
import { requireId, requireNonEmptyString } from "../domain/validation";

// Exposes creation of the existing flat Supplier reference (name)
// already in schema.prisma — not a supplier identity-resolution
// subsystem. R3 (staged identity resolution, no silent fuzzy merges) is
// not engaged by a plain, explicit, human-entered create: there is no
// matching or merging here. No uniqueness is enforced on name: the
// schema has none today, and this function preserves that.
export async function createSupplier(tenantId: string, name: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validName = requireNonEmptyString(name, "name");
  const db = tenantScoped(validTenantId);
  return db.supplier.create({ data: { tenantId: validTenantId, name: validName } });
}
