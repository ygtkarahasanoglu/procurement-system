import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { NotFoundError, InvalidStateError } from "../domain/errors";
import { requireId } from "../domain/validation";

// RL-C3: one ACTIVE SourcingEvent per Request Line.
//
// The check-then-create is run inside a SERIALIZABLE transaction, so
// PostgreSQL itself rejects one of two concurrent attempts to open a
// SourcingEvent on the same RequestLine (rather than relying solely on
// a check that has a TOCTOU race window under READ COMMITTED, Prisma's
// default). A resulting serialization failure (Prisma error code P2034)
// is translated into the same InvalidStateError a caller would see from
// the ordinary sequential check, so the race and the common case look
// identical to callers.
export async function createSourcingEvent(tenantId: string, requestLineId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validRequestLineId = requireId(requestLineId, "requestLineId");

  try {
    return await prisma.$transaction(
      async (tx) => {
        const line = await tx.requestLine.findFirst({
          where: { id: validRequestLineId, tenantId: validTenantId },
        });
        if (!line) {
          throw new NotFoundError("RequestLine", validRequestLineId);
        }

        const existingOpen = await tx.sourcingEvent.findFirst({
          where: { requestLineId: validRequestLineId, tenantId: validTenantId, status: "OPEN" },
        });
        if (existingOpen) {
          throw new InvalidStateError(
            `RequestLine ${validRequestLineId} already has an active SourcingEvent (${existingOpen.id}) — RL-C3.`
          );
        }

        return tx.sourcingEvent.create({
          data: { tenantId: validTenantId, requestLineId: validRequestLineId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      throw new InvalidStateError(
        `RequestLine ${validRequestLineId} already has, or concurrently received, an active SourcingEvent — RL-C3.`
      );
    }
    throw err;
  }
}
