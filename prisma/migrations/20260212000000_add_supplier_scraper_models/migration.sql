-- CreateEnum
CREATE TYPE "ScraperStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastProductCount" INTEGER,
    "lastMargin" DOUBLE PRECISION,
    "lastScrapeDuration" INTEGER,
    "lastScrapeAt" TIMESTAMP(3),
    "lastScrapeStatus" "ScraperStatus" NOT NULL DEFAULT 'IDLE',
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" "ScraperStatus" NOT NULL DEFAULT 'RUNNING',
    "productsScraped" INTEGER NOT NULL DEFAULT 0,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsFailed" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "averageMargin" DOUBLE PRECISION,
    "syncStatus" TEXT,
    "syncProductsTotal" INTEGER NOT NULL DEFAULT 0,
    "syncProductsDone" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_shop_idx" ON "Supplier"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shop_slug_key" ON "Supplier"("shop", "slug");

-- CreateIndex
CREATE INDEX "ScraperRun_supplierId_idx" ON "ScraperRun"("supplierId");

-- CreateIndex
CREATE INDEX "ScraperRun_shop_idx" ON "ScraperRun"("shop");

-- CreateIndex
CREATE INDEX "ScraperRun_startedAt_idx" ON "ScraperRun"("startedAt");

-- CreateIndex
CREATE INDEX "ScraperRun_status_idx" ON "ScraperRun"("status");

-- AddForeignKey
ALTER TABLE "ScraperRun" ADD CONSTRAINT "ScraperRun_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
