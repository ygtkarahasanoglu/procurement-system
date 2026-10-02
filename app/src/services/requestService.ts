import { prisma } from "../db/client";
import { NotFoundError, ValidationError } from "../domain/errors";
import { requireId, requirePositiveDecimal, requireUnit } from "../domain/validation";

// RL-C1: a ProcurementRequest may contain one or more independent lines.
// V1 only exercises a single line per request, but the schema and this
// service do not prevent more — RL-C1 itself is respected, not narrowed.

export interface CreateRequestLineInput {
  productId: string;
  requestedQuantity: string | number;
  unit: string;
}

export interface CreateRequestInput {
  tenantId: string;
  createdById: string;
  lines: CreateRequestLineInput[];
}

export async function createRequest(input: CreateRequestInput) {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }
  const tenantId = requireId(input.tenantId, "tenantId");
  const createdById = requireId(input.createdById, "createdById");

  const createdBy = await prisma.user.findFirst({ where: { id: createdById, tenantId } });
  if (!createdBy) {
    throw new NotFoundError("User", createdById);
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ValidationError("A ProcurementRequest must have at least one RequestLine.");
  }

  const validatedLines = await Promise.all(
    input.lines.map(async (line, index) => {
      if (line === null || typeof line !== "object") {
        throw new ValidationError(`lines[${index}] must be an object.`);
      }
      const productId = requireId(line.productId, `lines[${index}].productId`);
      const requestedQuantity = requirePositiveDecimal(line.requestedQuantity, `lines[${index}].requestedQuantity`);
      const unit = requireUnit(line.unit);

      const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
      if (!product) {
        throw new NotFoundError("Product", productId);
      }

      return { productId, requestedQuantity, unit };
    })
  );

  return prisma.procurementRequest.create({
    data: {
      tenantId,
      createdById,
      lines: {
        create: validatedLines.map((line) => ({
          tenantId,
          productId: line.productId,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
        })),
      },
    },
    include: { lines: true },
  });
}
