-- CreateTable
CREATE TABLE "fluktuasi_akun_periodes" (
    "id" SERIAL NOT NULL,
    "accountCode" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "klasifikasi" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "uploadedBy" TEXT NOT NULL DEFAULT 'system',
    "fileName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fluktuasi_akun_periodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fluktuasi_akun_periodes_accountCode_idx" ON "fluktuasi_akun_periodes"("accountCode");

-- CreateIndex
CREATE INDEX "fluktuasi_akun_periodes_periode_idx" ON "fluktuasi_akun_periodes"("periode");

-- CreateIndex
CREATE INDEX "fluktuasi_akun_periodes_uploadedBy_idx" ON "fluktuasi_akun_periodes"("uploadedBy");

-- CreateIndex
CREATE UNIQUE INDEX "fluktuasi_akun_periodes_accountCode_periode_key" ON "fluktuasi_akun_periodes"("accountCode", "periode");
