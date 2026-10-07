-- CreateTable
CREATE TABLE "RFQProviderDeliveryEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "correlationState" TEXT NOT NULL,
    "tenantId" TEXT,
    "rfqDispatchId" TEXT,
    "eventType" TEXT NOT NULL,
    "providerSubtype" TEXT,
    "providerEventAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,

    CONSTRAINT "RFQProviderDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RFQProviderDeliveryEvent_tenantId_idx" ON "RFQProviderDeliveryEvent"("tenantId");

-- CreateIndex
CREATE INDEX "RFQProviderDeliveryEvent_rfqDispatchId_idx" ON "RFQProviderDeliveryEvent"("rfqDispatchId");

-- CreateIndex
CREATE INDEX "RFQProviderDeliveryEvent_correlationState_idx" ON "RFQProviderDeliveryEvent"("correlationState");

-- CreateIndex
CREATE UNIQUE INDEX "RFQProviderDeliveryEvent_provider_providerEventId_key" ON "RFQProviderDeliveryEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "RFQProviderDeliveryEvent" ADD CONSTRAINT "RFQProviderDeliveryEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQProviderDeliveryEvent" ADD CONSTRAINT "RFQProviderDeliveryEvent_rfqDispatchId_fkey" FOREIGN KEY ("rfqDispatchId") REFERENCES "RFQDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
