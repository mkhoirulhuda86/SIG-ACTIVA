-- CreateTable
CREATE TABLE "fluktuasi_keywords" (
    "id" SERIAL NOT NULL,
    "keyword" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fluktuasi_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fluktuasi_keywords_type_idx" ON "fluktuasi_keywords"("type");

-- CreateIndex
CREATE INDEX "fluktuasi_keywords_keyword_idx" ON "fluktuasi_keywords"("keyword");
