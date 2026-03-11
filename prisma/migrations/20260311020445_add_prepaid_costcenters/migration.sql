-- CreateTable
CREATE TABLE "prepaid_periode_costcenters" (
    "id" SERIAL NOT NULL,
    "prepaidPeriodeId" INTEGER NOT NULL,
    "costCenter" TEXT,
    "kdAkunBiaya" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prepaid_periode_costcenters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prepaid_periode_costcenters_prepaidPeriodeId_idx" ON "prepaid_periode_costcenters"("prepaidPeriodeId");

-- AddForeignKey
ALTER TABLE "prepaid_periode_costcenters" ADD CONSTRAINT "prepaid_periode_costcenters_prepaidPeriodeId_fkey" FOREIGN KEY ("prepaidPeriodeId") REFERENCES "prepaid_periodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
