import { tenantScoped } from "../db/client";
import { requireId, requireNonEmptyString } from "../domain/validation";
import { NotFoundError } from "../domain/errors";

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

// Corrects ordinary data-entry mistakes (name) on an already-existing
// Supplier. Same non-decision as createSupplier above: no identity-
// resolution semantics, no uniqueness constraint. Mirrors
// decisionService.ts's existing atomic conditional-update pattern
// exactly — a cross-tenant or nonexistent supplierId is rejected
// identically (NotFoundError), never distinguished, never updateable.
export async function updateSupplier(tenantId: string, supplierId: string, name: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSupplierId = requireId(supplierId, "supplierId");
  const validName = requireNonEmptyString(name, "name");
  const db = tenantScoped(validTenantId);

  const result = await db.supplier.updateMany({
    where: { id: validSupplierId, tenantId: validTenantId },
    data: { name: validName },
  });
  if (result.count === 0) {
    throw new NotFoundError("Supplier", validSupplierId);
  }

  return db.supplier.findUniqueOrThrow({ where: { id: validSupplierId } });
}
