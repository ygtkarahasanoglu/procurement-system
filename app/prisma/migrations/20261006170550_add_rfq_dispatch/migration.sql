-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "SupplierQuote" ADD COLUMN     "rfqDispatchId" TEXT;

-- CreateTable
CREATE TABLE "RFQDispatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourcingEventId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RFQDispatch_responseTokenHash_key" ON "RFQDispatch"("responseTokenHash");

-- CreateIndex
CREATE INDEX "RFQDispatch_tenantId_idx" ON "RFQDispatch"("tenantId");

-- CreateIndex
CREATE INDEX "RFQDispatch_sourcingEventId_idx" ON "RFQDispatch"("sourcingEventId");

-- CreateIndex
CREATE INDEX "RFQDispatch_supplierId_idx" ON "RFQDispatch"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQuote_rfqDispatchId_idx" ON "SupplierQuote"("rfqDispatchId");

-- AddForeignKey
ALTER TABLE "RFQDispatch" ADD CONSTRAINT "RFQDispatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQDispatch" ADD CONSTRAINT "RFQDispatch_sourcingEventId_fkey" FOREIGN KEY ("sourcingEventId") REFERENCES "SourcingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQDispatch" ADD CONSTRAINT "RFQDispatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_rfqDispatchId_fkey" FOREIGN KEY ("rfqDispatchId") REFERENCES "RFQDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
