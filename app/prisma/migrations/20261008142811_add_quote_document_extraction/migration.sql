-- AlterTable
ALTER TABLE "QuoteVersion" ADD COLUMN     "incoterm" TEXT,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "paymentTermDays" INTEGER,
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuoteDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourcingEventId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "rfqDispatchId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedVia" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteExtraction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteDocumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "extracted" JSONB,
    "errorMessage" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "quoteVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteDocument_tenantId_idx" ON "QuoteDocument"("tenantId");

-- CreateIndex
CREATE INDEX "QuoteDocument_sourcingEventId_idx" ON "QuoteDocument"("sourcingEventId");

-- CreateIndex
CREATE INDEX "QuoteDocument_supplierId_idx" ON "QuoteDocument"("supplierId");

-- CreateIndex
CREATE INDEX "QuoteDocument_rfqDispatchId_idx" ON "QuoteDocument"("rfqDispatchId");

-- CreateIndex
CREATE INDEX "QuoteExtraction_tenantId_idx" ON "QuoteExtraction"("tenantId");

-- CreateIndex
CREATE INDEX "QuoteExtraction_quoteDocumentId_idx" ON "QuoteExtraction"("quoteDocumentId");

-- AddForeignKey
ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_sourcingEventId_fkey" FOREIGN KEY ("sourcingEventId") REFERENCES "SourcingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_rfqDispatchId_fkey" FOREIGN KEY ("rfqDispatchId") REFERENCES "RFQDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteExtraction" ADD CONSTRAINT "QuoteExtraction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteExtraction" ADD CONSTRAINT "QuoteExtraction_quoteDocumentId_fkey" FOREIGN KEY ("quoteDocumentId") REFERENCES "QuoteDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteExtraction" ADD CONSTRAINT "QuoteExtraction_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
