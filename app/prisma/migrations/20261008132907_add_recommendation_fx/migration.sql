-- AlterTable
ALTER TABLE "RecommendationRecord" ADD COLUMN     "fxBulletinDate" TEXT,
ADD COLUMN     "fxRateType" TEXT,
ADD COLUMN     "fxRatesUsed" JSONB,
ADD COLUMN     "fxSource" TEXT;
