-- CreateTable
CREATE TABLE "fluktuasi_imports" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "sheetDataList" JSONB NOT NULL,
    "rekapSheetData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fluktuasi_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fluktuasi_imports_uploadedBy_idx" ON "fluktuasi_imports"("uploadedBy");

-- CreateIndex
CREATE INDEX "fluktuasi_imports_createdAt_idx" ON "fluktuasi_imports"("createdAt");
