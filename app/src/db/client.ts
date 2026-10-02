import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the process. For V1 this is
// sufficient; connection pooling tuning is explicitly out of scope.
export const prisma = new PrismaClient();
