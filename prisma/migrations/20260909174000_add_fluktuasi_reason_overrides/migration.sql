CREATE TABLE "fluktuasi_reason_overrides" (
  "id" SERIAL NOT NULL,
  "accountCode" TEXT NOT NULL,
  "comparisonType" TEXT NOT NULL,
  "currentPeriod" TEXT NOT NULL,
  "comparisonPeriod" TEXT NOT NULL DEFAULT '',
  "generatedReason" TEXT NOT NULL DEFAULT '',
  "userComment" TEXT NOT NULL,
  "updatedById" INTEGER,
  "updatedByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fluktuasi_reason_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fluktuasi_reason_overrides_comparison_type_check"
    CHECK ("comparisonType" IN ('MOM', 'YOY', 'YTD')),
  CONSTRAINT "fluktuasi_reason_overrides_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fluktuasi_reason_overrides_unique_key"
  ON "fluktuasi_reason_overrides"("accountCode", "comparisonType", "currentPeriod", "comparisonPeriod");

CREATE INDEX "fluktuasi_reason_overrides_current_period_idx"
  ON "fluktuasi_reason_overrides"("currentPeriod");

CREATE INDEX "fluktuasi_reason_overrides_account_idx"
  ON "fluktuasi_reason_overrides"("accountCode");

CREATE INDEX "fluktuasi_reason_overrides_updated_at_idx"
  ON "fluktuasi_reason_overrides"("updatedAt");
