-- Stage B: additive and isolated Raw SAP V2 workflow persistence only.
CREATE TYPE "CostRawV2PeriodStatus" AS ENUM ('SKELETON', 'UPLOADED', 'VALIDATING', 'VALIDATED', 'CALCULATING', 'CALCULATED', 'FINALIZED');
CREATE TYPE "CostRawV2UploadStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED', 'INVALID', 'SUPERSEDED');
CREATE TYPE "CostRawV2CalculationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "cost_raw_v2_periods" (
  "id" SERIAL PRIMARY KEY,
  "companyCode" TEXT NOT NULL,
  "fiscalYear" INTEGER NOT NULL,
  "fiscalPeriod" INTEGER NOT NULL,
  "status" "CostRawV2PeriodStatus" NOT NULL DEFAULT 'SKELETON',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "cost_raw_v2_uploads" (
  "id" SERIAL PRIMARY KEY,
  "periodId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "fileHashSha256" TEXT NOT NULL,
  "fileSizeBytes" BIGINT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "status" "CostRawV2UploadStatus" NOT NULL DEFAULT 'UPLOADED',
  "isActiveVersion" BOOLEAN NOT NULL DEFAULT true,
  "uploadedById" INTEGER NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "cost_raw_v2_source_rows" (
  "id" SERIAL PRIMARY KEY,
  "uploadId" INTEGER NOT NULL,
  "logicalSourceCode" TEXT NOT NULL,
  "originalSheetName" TEXT NOT NULL,
  "sourceRowNumber" INTEGER NOT NULL,
  "rawDataJson" JSONB NOT NULL,
  "normalizedDataJson" JSONB,
  "coaCodeRaw" TEXT,
  "coaCodeResolved" TEXT,
  "descriptionRaw" TEXT,
  "amount" NUMERIC(20,2),
  "normalizationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "cost_raw_v2_validation_issues" (
  "id" SERIAL PRIMARY KEY,
  "uploadId" INTEGER NOT NULL,
  "sourceRowId" INTEGER,
  "issueCode" TEXT NOT NULL,
  "severity" "CostValidationSeverity" NOT NULL,
  "message" TEXT NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolutionType" TEXT,
  "resolutionNote" TEXT,
  "resolvedById" INTEGER,
  "resolvedAt" TIMESTAMP(3),
  "resolutionMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "cost_raw_v2_calculation_runs" (
  "id" SERIAL PRIMARY KEY,
  "periodId" INTEGER NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "uploadId" INTEGER NOT NULL,
  "status" "CostRawV2CalculationRunStatus" NOT NULL DEFAULT 'PENDING',
  "ruleSetVersion" TEXT NOT NULL,
  "sourceSnapshotJson" JSONB NOT NULL,
  "mappingSnapshotJson" JSONB,
  "startedById" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "cost_raw_v2_periods_companyCode_fiscalYear_fiscalPeriod_key" ON "cost_raw_v2_periods"("companyCode", "fiscalYear", "fiscalPeriod");
CREATE INDEX "cost_raw_v2_periods_status_idx" ON "cost_raw_v2_periods"("status");
CREATE UNIQUE INDEX "cost_raw_v2_uploads_periodId_version_key" ON "cost_raw_v2_uploads"("periodId", "version");
CREATE UNIQUE INDEX "cost_raw_v2_uploads_periodId_fileHashSha256_key" ON "cost_raw_v2_uploads"("periodId", "fileHashSha256");
CREATE INDEX "cost_raw_v2_uploads_periodId_isActiveVersion_idx" ON "cost_raw_v2_uploads"("periodId", "isActiveVersion");
CREATE UNIQUE INDEX "cost_raw_v2_uploads_one_active_per_period_key" ON "cost_raw_v2_uploads"("periodId") WHERE "isActiveVersion" = true;
CREATE INDEX "cost_raw_v2_uploads_uploadedById_idx" ON "cost_raw_v2_uploads"("uploadedById");
CREATE INDEX "cost_raw_v2_uploads_status_idx" ON "cost_raw_v2_uploads"("status");
CREATE INDEX "cost_raw_v2_source_rows_uploadId_logicalSourceCode_idx" ON "cost_raw_v2_source_rows"("uploadId", "logicalSourceCode");
CREATE INDEX "cost_raw_v2_source_rows_coaCodeRaw_idx" ON "cost_raw_v2_source_rows"("coaCodeRaw");
CREATE INDEX "cost_raw_v2_source_rows_normalizationStatus_idx" ON "cost_raw_v2_source_rows"("normalizationStatus");
CREATE INDEX "cost_raw_v2_validation_issues_uploadId_severity_idx" ON "cost_raw_v2_validation_issues"("uploadId", "severity");
CREATE INDEX "cost_raw_v2_validation_issues_sourceRowId_idx" ON "cost_raw_v2_validation_issues"("sourceRowId");
CREATE INDEX "cost_raw_v2_validation_issues_issueCode_idx" ON "cost_raw_v2_validation_issues"("issueCode");
CREATE INDEX "cost_raw_v2_validation_issues_resolved_idx" ON "cost_raw_v2_validation_issues"("resolved");
CREATE INDEX "cost_raw_v2_validation_issues_resolvedById_idx" ON "cost_raw_v2_validation_issues"("resolvedById");
CREATE UNIQUE INDEX "cost_raw_v2_calculation_runs_periodId_runNumber_key" ON "cost_raw_v2_calculation_runs"("periodId", "runNumber");
CREATE INDEX "cost_raw_v2_calculation_runs_periodId_isActive_idx" ON "cost_raw_v2_calculation_runs"("periodId", "isActive");
CREATE UNIQUE INDEX "cost_raw_v2_calculation_runs_one_active_per_period_key" ON "cost_raw_v2_calculation_runs"("periodId") WHERE "isActive" = true;
CREATE INDEX "cost_raw_v2_calculation_runs_uploadId_idx" ON "cost_raw_v2_calculation_runs"("uploadId");
CREATE INDEX "cost_raw_v2_calculation_runs_status_idx" ON "cost_raw_v2_calculation_runs"("status");
CREATE INDEX "cost_raw_v2_calculation_runs_startedById_idx" ON "cost_raw_v2_calculation_runs"("startedById");

ALTER TABLE "cost_raw_v2_uploads" ADD CONSTRAINT "cost_raw_v2_uploads_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_raw_v2_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_uploads" ADD CONSTRAINT "cost_raw_v2_uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_source_rows" ADD CONSTRAINT "cost_raw_v2_source_rows_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_raw_v2_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_validation_issues" ADD CONSTRAINT "cost_raw_v2_validation_issues_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_raw_v2_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_validation_issues" ADD CONSTRAINT "cost_raw_v2_validation_issues_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "cost_raw_v2_source_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_validation_issues" ADD CONSTRAINT "cost_raw_v2_validation_issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_calculation_runs" ADD CONSTRAINT "cost_raw_v2_calculation_runs_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_raw_v2_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_calculation_runs" ADD CONSTRAINT "cost_raw_v2_calculation_runs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_raw_v2_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_raw_v2_calculation_runs" ADD CONSTRAINT "cost_raw_v2_calculation_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
