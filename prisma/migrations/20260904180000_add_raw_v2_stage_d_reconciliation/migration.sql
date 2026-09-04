-- Raw V2 Stage D only. Apply through the controlled Supabase migration process.
CREATE TABLE "cost_raw_v2_reconciliations" (
  "id" SERIAL PRIMARY KEY, "calculationRunId" INTEGER NOT NULL UNIQUE,
  "status" TEXT NOT NULL, "tbRowCount" INTEGER NOT NULL, "tbNonZeroCount" INTEGER NOT NULL,
  "uniqueCcCoaCount" INTEGER NOT NULL, "foundInTbCount" INTEGER NOT NULL, "missingInTbCount" INTEGER NOT NULL,
  "exactMatchCount" INTEGER NOT NULL, "mismatchCount" INTEGER NOT NULL,
  "totalAdum" NUMERIC(20,2) NOT NULL, "totalPasar" NUMERIC(20,2) NOT NULL,
  "totalBaseCc" NUMERIC(20,2) NOT NULL, "totalTbPopulation" NUMERIC(20,2) NOT NULL,
  "totalDifference" NUMERIC(20,2) NOT NULL, "derivPresenceStatus" TEXT NOT NULL,
  "derivDetailRowCount" INTEGER NOT NULL, "derivNonZeroCount" INTEGER NOT NULL,
  "derivTotal" NUMERIC(20,2) NOT NULL, "derivDebitControl" NUMERIC(20,2),
  "derivSourceDifference" NUMERIC(20,2), "derivPasarCoverageMissing" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_raw_v2_reconciliations_calculationRunId_fkey" FOREIGN KEY ("calculationRunId") REFERENCES "cost_raw_v2_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cost_raw_v2_reconciliations_status_idx" ON "cost_raw_v2_reconciliations"("status");

CREATE TABLE "cost_raw_v2_reconciliation_rows" (
  "id" SERIAL PRIMARY KEY, "reconciliationId" INTEGER NOT NULL, "coaCode" TEXT NOT NULL,
  "adumAmount" NUMERIC(20,2) NOT NULL, "pasarAmount" NUMERIC(20,2) NOT NULL,
  "ccAmount" NUMERIC(20,2) NOT NULL, "tbAmount" NUMERIC(20,2), "difference" NUMERIC(20,2),
  "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_raw_v2_reconciliation_rows_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "cost_raw_v2_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cost_raw_v2_reconciliation_rows_reconciliationId_coaCode_key" UNIQUE ("reconciliationId", "coaCode")
);
CREATE INDEX "cost_raw_v2_reconciliation_rows_reconciliationId_status_idx" ON "cost_raw_v2_reconciliation_rows"("reconciliationId", "status");

CREATE TABLE "cost_raw_v2_analytical_rows" (
  "id" SERIAL PRIMARY KEY, "calculationRunId" INTEGER NOT NULL, "sourceRowId" INTEGER NOT NULL,
  "logicalSourceCode" TEXT NOT NULL, "originalSheetName" TEXT NOT NULL, "sourceRowNumber" INTEGER NOT NULL,
  "coaCode" TEXT NOT NULL, "descriptionRaw" TEXT, "rawAmount" NUMERIC(20,2) NOT NULL,
  "analyticalClass" TEXT NOT NULL, "mappedAmount" NUMERIC(20,2) NOT NULL,
  "mappingStatus" TEXT NOT NULL, "ruleSetVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_raw_v2_analytical_rows_calculationRunId_fkey" FOREIGN KEY ("calculationRunId") REFERENCES "cost_raw_v2_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cost_raw_v2_analytical_rows_calculationRunId_sourceRowId_key" UNIQUE ("calculationRunId", "sourceRowId")
);
CREATE INDEX "cost_raw_v2_analytical_rows_calculationRunId_logicalSourceCode_coaCode_idx" ON "cost_raw_v2_analytical_rows"("calculationRunId", "logicalSourceCode", "coaCode");
