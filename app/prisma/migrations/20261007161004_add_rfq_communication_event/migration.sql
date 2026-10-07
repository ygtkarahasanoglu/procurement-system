-- CreateTable
CREATE TABLE "RFQCommunicationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfqDispatchId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorSource" TEXT NOT NULL,
    "actorUserId" TEXT,
    "outcome" TEXT,
    "providerMessageId" TEXT,
    "quoteVersionId" TEXT,

    CONSTRAINT "RFQCommunicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RFQCommunicationEvent_tenantId_idx" ON "RFQCommunicationEvent"("tenantId");

-- CreateIndex
CREATE INDEX "RFQCommunicationEvent_rfqDispatchId_idx" ON "RFQCommunicationEvent"("rfqDispatchId");

-- AddForeignKey
ALTER TABLE "RFQCommunicationEvent" ADD CONSTRAINT "RFQCommunicationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQCommunicationEvent" ADD CONSTRAINT "RFQCommunicationEvent_rfqDispatchId_fkey" FOREIGN KEY ("rfqDispatchId") REFERENCES "RFQDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQCommunicationEvent" ADD CONSTRAINT "RFQCommunicationEvent_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
