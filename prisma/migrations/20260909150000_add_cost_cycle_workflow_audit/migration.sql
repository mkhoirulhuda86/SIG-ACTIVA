-- Additive audit persistence for the native Update Cycle SAP workflow.
ALTER TABLE "cost_cycle_references" ADD COLUMN "updatedById" INTEGER;

CREATE TABLE "cost_cycle_change_runs" (
  "id" SERIAL PRIMARY KEY, "uploadId" INTEGER NOT NULL, "sourceVersion" INTEGER NOT NULL,
  "sourceHashSha256" TEXT NOT NULL, "masterFingerprint" TEXT NOT NULL,
  "changedCcCount" INTEGER NOT NULL, "warningCount" INTEGER NOT NULL DEFAULT 0,
  "generatedById" INTEGER NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "cost_cycle_changes" (
  "id" BIGSERIAL PRIMARY KEY, "runId" INTEGER NOT NULL, "receiverCc" TEXT NOT NULL,
  "baselineStatus" TEXT NOT NULL, "targetStatus" TEXT NOT NULL, "action" TEXT NOT NULL,
  "referenceCc" TEXT, "referenceSource" TEXT, "referenceReviewStatus" TEXT,
  "referenceConfidence" TEXT, "fixedAffectedRows" INTEGER NOT NULL,
  "variableAffectedRows" INTEGER NOT NULL, "issueSummaryJson" JSONB
);
CREATE TABLE "cost_cycle_generated_files" (
  "id" SERIAL PRIMARY KEY, "runId" INTEGER NOT NULL, "cycle" TEXT NOT NULL,
  "fileName" TEXT NOT NULL, "rowCount" INTEGER NOT NULL, "fileHashSha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "cost_cycle_references_updatedById_idx" ON "cost_cycle_references"("updatedById");
CREATE INDEX "cost_cycle_change_runs_uploadId_generatedAt_idx" ON "cost_cycle_change_runs"("uploadId", "generatedAt");
CREATE INDEX "cost_cycle_change_runs_generatedById_idx" ON "cost_cycle_change_runs"("generatedById");
CREATE INDEX "cost_cycle_changes_runId_receiverCc_idx" ON "cost_cycle_changes"("runId", "receiverCc");
CREATE INDEX "cost_cycle_generated_files_runId_idx" ON "cost_cycle_generated_files"("runId");
ALTER TABLE "cost_cycle_references" ADD CONSTRAINT "cost_cycle_references_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_change_runs" ADD CONSTRAINT "cost_cycle_change_runs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_cycle_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_change_runs" ADD CONSTRAINT "cost_cycle_change_runs_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_changes" ADD CONSTRAINT "cost_cycle_changes_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cost_cycle_change_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_generated_files" ADD CONSTRAINT "cost_cycle_generated_files_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cost_cycle_change_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
