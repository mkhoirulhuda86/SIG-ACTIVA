-- CreateTable
CREATE TABLE "fluktuasi_sheet_rows" (
    "id" SERIAL NOT NULL,
    "accountCode" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "originalHeaders" JSONB NOT NULL,
    "klasifikasiColIdx" INTEGER,
    "docnoColIdx" INTEGER,
    "rows" JSONB NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fluktuasi_sheet_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fluktuasi_sheet_rows_accountCode_key" ON "fluktuasi_sheet_rows"("accountCode");

-- CreateIndex
CREATE INDEX "fluktuasi_sheet_rows_accountCode_idx" ON "fluktuasi_sheet_rows"("accountCode");
