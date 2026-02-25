-- CreateTable
CREATE TABLE "accrual_periode_costcenters" (
    "id" SERIAL NOT NULL,
    "accrualPeriodeId" INTEGER NOT NULL,
    "costCenter" TEXT,
    "kdAkunBiaya" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accrual_periode_costcenters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accrual_periode_costcenters_accrualPeriodeId_idx" ON "accrual_periode_costcenters"("accrualPeriodeId");

-- AddForeignKey
ALTER TABLE "accrual_periode_costcenters" ADD CONSTRAINT "accrual_periode_costcenters_accrualPeriodeId_fkey" FOREIGN KEY ("accrualPeriodeId") REFERENCES "accrual_periodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
