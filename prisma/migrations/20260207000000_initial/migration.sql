-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('CRON', 'MANUAL', 'WEBHOOK', 'N8N');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "geminiApiKey" TEXT,
    "goUpcApiKey" TEXT,
    "barcodeLookupApiKey" TEXT,
    "googleSearchApiKey" TEXT,
    "googleSearchCx" TEXT,
    "internalApiKey" TEXT,
    "minioAccessKey" TEXT,
    "minioSecretKey" TEXT,
    "minioBucket" TEXT NOT NULL DEFAULT 'smartenrich-images',
    "cronSchedule" TEXT NOT NULL DEFAULT '0 2 * * *',
    "cronEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "maxProductsPerRun" INTEGER NOT NULL DEFAULT 50,
    "minConfidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "excludeVendors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeProductTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" "TriggerType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "enrichedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyProductTitle" TEXT NOT NULL,
    "scoreBefore" INTEGER NOT NULL,
    "scoreAfter" INTEGER,
    "status" "LogStatus" NOT NULL DEFAULT 'PENDING',
    "originalData" JSONB NOT NULL,
    "proposedChanges" JSONB,
    "appliedChanges" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "aiModel" TEXT,
    "aiResponseRaw" TEXT,
    "barcodeData" JSONB,
    "searchData" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "EnrichmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_shop_key" ON "AppConfig"("shop");

-- CreateIndex
CREATE INDEX "EnrichmentRun_shop_idx" ON "EnrichmentRun"("shop");

-- CreateIndex
CREATE INDEX "EnrichmentRun_status_idx" ON "EnrichmentRun"("status");

-- CreateIndex
CREATE INDEX "EnrichmentRun_startedAt_idx" ON "EnrichmentRun"("startedAt");

-- CreateIndex
CREATE INDEX "EnrichmentLog_runId_idx" ON "EnrichmentLog"("runId");

-- CreateIndex
CREATE INDEX "EnrichmentLog_shop_idx" ON "EnrichmentLog"("shop");

-- CreateIndex
CREATE INDEX "EnrichmentLog_shopifyProductId_idx" ON "EnrichmentLog"("shopifyProductId");

-- CreateIndex
CREATE INDEX "EnrichmentLog_status_idx" ON "EnrichmentLog"("status");

-- AddForeignKey
ALTER TABLE "EnrichmentLog" ADD CONSTRAINT "EnrichmentLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EnrichmentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
