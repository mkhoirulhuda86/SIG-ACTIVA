-- Raw V2 Stage E is applied through controlled Supabase migration tooling; do not deploy the legacy chain.
ALTER TABLE "cost_raw_v2_analytical_rows"
  ADD COLUMN "mappingAction" TEXT,
  ADD COLUMN "mappingId" INTEGER,
  ADD COLUMN "costGroupId" INTEGER,
  ADD COLUMN "costGroupCode" TEXT,
  ADD COLUMN "natureId" INTEGER,
  ADD COLUMN "natureCode" TEXT,
  ADD COLUMN "mappingEffectiveDate" TIMESTAMP(3),
  ADD COLUMN "ruleCode" TEXT,
  ADD COLUMN "referenceJson" JSONB;

CREATE TABLE "cost_raw_v2_results" (
  "id" SERIAL PRIMARY KEY, "calculationRunId" INTEGER NOT NULL, "resultLevel" TEXT NOT NULL,
  "resultCode" TEXT NOT NULL, "costGroupId" INTEGER, "costGroupCode" TEXT, "natureId" INTEGER,
  "natureCode" TEXT, "amount" NUMERIC(20,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_raw_v2_results_calculationRunId_fkey" FOREIGN KEY ("calculationRunId") REFERENCES "cost_raw_v2_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cost_raw_v2_results_calculationRunId_resultCode_key" ON "cost_raw_v2_results"("calculationRunId", "resultCode");
CREATE INDEX "cost_raw_v2_results_calculationRunId_resultLevel_idx" ON "cost_raw_v2_results"("calculationRunId", "resultLevel");

CREATE TABLE "cost_raw_v2_controls" (
  "id" SERIAL PRIMARY KEY, "calculationRunId" INTEGER NOT NULL, "controlCode" TEXT NOT NULL,
  "sourceLogicalCode" TEXT, "status" TEXT NOT NULL, "sourceAmount" NUMERIC(20,2) NOT NULL,
  "accountedAmount" NUMERIC(20,2) NOT NULL, "difference" NUMERIC(20,2) NOT NULL,
  "metricsJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_raw_v2_controls_calculationRunId_fkey" FOREIGN KEY ("calculationRunId") REFERENCES "cost_raw_v2_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cost_raw_v2_controls_calculationRunId_controlCode_key" ON "cost_raw_v2_controls"("calculationRunId", "controlCode");
CREATE INDEX "cost_raw_v2_controls_calculationRunId_status_idx" ON "cost_raw_v2_controls"("calculationRunId", "status");
