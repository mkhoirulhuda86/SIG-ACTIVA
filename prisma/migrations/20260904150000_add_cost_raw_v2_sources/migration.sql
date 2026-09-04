-- Additive Stage C source summaries. No legacy workflow object is altered.
CREATE TABLE "cost_raw_v2_sources" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "logicalSourceCode" TEXT NOT NULL,
    "originalSheetName" TEXT,
    "presenceStatus" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "fiscalYear" INTEGER,
    "fiscalPeriod" INTEGER,
    "controllingArea" TEXT,
    "costCenterGroup" TEXT,
    "headerRowNumber" INTEGER,
    "detailRowCount" INTEGER NOT NULL DEFAULT 0,
    "nonZeroDetailRowCount" INTEGER NOT NULL DEFAULT 0,
    "detailTotal" DECIMAL(20,2),
    "debitControl" DECIMAL(20,2),
    "overUnderControl" DECIMAL(20,2),
    "reconciliationDifference" DECIMAL(20,2),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_raw_v2_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_raw_v2_sources_uploadId_logicalSourceCode_key"
ON "cost_raw_v2_sources"("uploadId", "logicalSourceCode");
CREATE INDEX "cost_raw_v2_sources_uploadId_presenceStatus_idx"
ON "cost_raw_v2_sources"("uploadId", "presenceStatus");
ALTER TABLE "cost_raw_v2_sources" ADD CONSTRAINT "cost_raw_v2_sources_uploadId_fkey"
FOREIGN KEY ("uploadId") REFERENCES "cost_raw_v2_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
