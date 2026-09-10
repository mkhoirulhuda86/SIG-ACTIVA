-- Additive, isolated Update Cycle SAP ingestion schema. No existing table is altered or removed.
CREATE TYPE "CostCyclePeriodStatus" AS ENUM ('OPEN', 'VALIDATING', 'READY', 'INVALID');
CREATE TYPE "CostCycleUploadStatus" AS ENUM ('VALIDATING', 'VALIDATED', 'INVALID', 'SUPERSEDED');
CREATE TYPE "CostCycleIssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');
CREATE TYPE "CostCycleReferenceReviewStatus" AS ENUM ('VALIDATED', 'PROPOSED', 'MANUAL_REQUIRED');

CREATE TABLE "cost_cycle_periods" ("id" SERIAL PRIMARY KEY, "fiscalYear" INTEGER NOT NULL, "fiscalPeriod" INTEGER NOT NULL, "status" "CostCyclePeriodStatus" NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "cost_cycle_uploads" ("id" SERIAL PRIMARY KEY, "periodId" INTEGER NOT NULL, "version" INTEGER NOT NULL, "originalFileName" TEXT NOT NULL, "fileHashSha256" TEXT NOT NULL, "fileSizeBytes" BIGINT NOT NULL, "storageProvider" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "isActiveVersion" BOOLEAN NOT NULL DEFAULT true, "status" "CostCycleUploadStatus" NOT NULL DEFAULT 'VALIDATING', "totalRowCount" INTEGER NOT NULL DEFAULT 0, "fixedRowCount" INTEGER NOT NULL DEFAULT 0, "variableRowCount" INTEGER NOT NULL DEFAULT 0, "uniqueReceiverCcCount" INTEGER NOT NULL DEFAULT 0, "errorCount" INTEGER NOT NULL DEFAULT 0, "warningCount" INTEGER NOT NULL DEFAULT 0, "uploadedById" INTEGER NOT NULL, "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "validatedAt" TIMESTAMP(3), "supersededAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "cost_cycle_source_rows" ("id" BIGSERIAL PRIMARY KEY, "uploadId" INTEGER NOT NULL, "sourceOrder" INTEGER NOT NULL, "sourceRowNumber" INTEGER NOT NULL, "sourceSheetName" TEXT NOT NULL, "cycle" TEXT NOT NULL, "startDate" DATE NOT NULL, "segmentName" TEXT NOT NULL, "receiverCc" TEXT NOT NULL, "portion" DECIMAL(20,6) NOT NULL, "rawDataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "cost_cycle_validation_issues" ("id" BIGSERIAL PRIMARY KEY, "uploadId" INTEGER NOT NULL, "sourceRowNumber" INTEGER, "issueCode" TEXT NOT NULL, "severity" "CostCycleIssueSeverity" NOT NULL, "message" TEXT NOT NULL, "metadataJson" JSONB, "resolvedAt" TIMESTAMP(3), "resolvedById" INTEGER, "resolutionNote" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "cost_cycle_cc_masters" ("id" SERIAL PRIMARY KEY, "receiverCc" TEXT NOT NULL, "receiverDescription" TEXT NOT NULL, "plantCode" TEXT NOT NULL, "plantName" TEXT NOT NULL, "processCode" TEXT NOT NULL, "processLabel" TEXT NOT NULL, "displayOrder" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "cost_cycle_references" ("id" SERIAL PRIMARY KEY, "receiverCc" TEXT NOT NULL, "peerGroup" TEXT NOT NULL, "preferredReferenceCc" TEXT, "fallbackReferenceCcs" JSONB NOT NULL, "confidence" TEXT NOT NULL, "reviewStatus" "CostCycleReferenceReviewStatus" NOT NULL, "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);

CREATE UNIQUE INDEX "cost_cycle_periods_fiscalYear_fiscalPeriod_key" ON "cost_cycle_periods"("fiscalYear", "fiscalPeriod");
CREATE INDEX "cost_cycle_periods_status_idx" ON "cost_cycle_periods"("status");
CREATE UNIQUE INDEX "cost_cycle_uploads_periodId_version_key" ON "cost_cycle_uploads"("periodId", "version");
CREATE UNIQUE INDEX "cost_cycle_uploads_periodId_fileHashSha256_key" ON "cost_cycle_uploads"("periodId", "fileHashSha256");
CREATE UNIQUE INDEX "cost_cycle_uploads_storageKey_key" ON "cost_cycle_uploads"("storageKey");
CREATE UNIQUE INDEX "cost_cycle_uploads_one_active_per_period" ON "cost_cycle_uploads"("periodId") WHERE "isActiveVersion" = true;
CREATE INDEX "cost_cycle_uploads_periodId_isActiveVersion_idx" ON "cost_cycle_uploads"("periodId", "isActiveVersion");
CREATE INDEX "cost_cycle_uploads_uploadedById_idx" ON "cost_cycle_uploads"("uploadedById");
CREATE INDEX "cost_cycle_uploads_status_idx" ON "cost_cycle_uploads"("status");
CREATE UNIQUE INDEX "cost_cycle_source_rows_uploadId_sourceOrder_key" ON "cost_cycle_source_rows"("uploadId", "sourceOrder");
CREATE UNIQUE INDEX "cost_cycle_source_rows_uploadId_cycle_segmentName_receiverCc_key" ON "cost_cycle_source_rows"("uploadId", "cycle", "segmentName", "receiverCc");
CREATE INDEX "cost_cycle_source_rows_uploadId_receiverCc_idx" ON "cost_cycle_source_rows"("uploadId", "receiverCc");
CREATE INDEX "cost_cycle_validation_issues_uploadId_severity_idx" ON "cost_cycle_validation_issues"("uploadId", "severity");
CREATE INDEX "cost_cycle_validation_issues_resolvedById_idx" ON "cost_cycle_validation_issues"("resolvedById");
CREATE UNIQUE INDEX "cost_cycle_cc_masters_receiverCc_key" ON "cost_cycle_cc_masters"("receiverCc");
CREATE INDEX "cost_cycle_cc_masters_active_plantCode_displayOrder_idx" ON "cost_cycle_cc_masters"("active", "plantCode", "displayOrder");
CREATE UNIQUE INDEX "cost_cycle_references_receiverCc_key" ON "cost_cycle_references"("receiverCc");
CREATE INDEX "cost_cycle_references_active_reviewStatus_idx" ON "cost_cycle_references"("active", "reviewStatus");
ALTER TABLE "cost_cycle_uploads" ADD CONSTRAINT "cost_cycle_uploads_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "cost_cycle_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_uploads" ADD CONSTRAINT "cost_cycle_uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_source_rows" ADD CONSTRAINT "cost_cycle_source_rows_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_cycle_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_validation_issues" ADD CONSTRAINT "cost_cycle_validation_issues_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "cost_cycle_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_cycle_validation_issues" ADD CONSTRAINT "cost_cycle_validation_issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotent authoritative CC master seed. Re-running refreshes descriptive attributes without duplicating identities.
INSERT INTO "cost_cycle_cc_masters" ("receiverCc","receiverDescription","plantCode","plantName","processCode","processLabel","displayOrder","active","createdAt","updatedAt") VALUES
('7103341041','KILN GSK SIE OP FM GRESIK','7301','PL Plant Gresik','KILN','Kiln',50,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341051','FINISH MILL GSK OP FM GRESIK','7301','PL Plant Gresik','FINISH_MILL','Finish Mill',60,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121011','CRUSHER BT. KAPUR TUBAN1','7302','PL Plant Tuban I','CRUSHER_BK','Crusher BK',10,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121021','CRUSHER TNH LIAT TUBAN1','7302','PL Plant Tuban I','CRUSHER_TL','Crusher TL',20,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211031','RAW MILL TBN1 SEKSI RKC1','7302','PL Plant Tuban I','RAW_MEAL','Raw Meal',30,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211071','COAL MILL TUBAN1 - SEKSI RKC1','7302','PL Plant Tuban I','FINE_COAL','Fine Coal',40,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203210071','NEW COAL MILL TUBAN 123','7302','PL Plant Tuban I','FINE_COAL_NEW','Fine Coal - New Coal Mill',45,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211041','KILN TUBAN1 - SEKSI RKC1','7302','PL Plant Tuban I','KILN','Kiln',50,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311051','FINISH MILL 1 T1 SEKSI FM TBN','7302','PL Plant Tuban I','FINISH_MILL','Finish Mill 1',61,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311052','FINISH MILL 2 T1 SEKSI FM TBN','7302','PL Plant Tuban I','FINISH_MILL','Finish Mill 2',62,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311059','FINISH MILL 9 SEKSI FM TUBAN','7302','PL Plant Tuban I','FINISH_MILL','Finish Mill 9',69,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121012','CRUSHER BT. KAPUR TUBAN2','7303','PL Plant Tuban II','CRUSHER_BK','Crusher BK',10,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121022','CRUSHER TNH LIAT TUBAN2','7303','PL Plant Tuban II','CRUSHER_TL','Crusher TL',20,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212032','RAW MILL TBN2 - SEKSI RKC2','7303','PL Plant Tuban II','RAW_MEAL','Raw Meal',30,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212072','COAL MILL TBN2 - SEKSI RKC2','7303','PL Plant Tuban II','FINE_COAL','Fine Coal',40,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212042','KILN TBN2 - SEKSI RKC2','7303','PL Plant Tuban II','KILN','Kiln',50,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311053','FINISH MILL 1 T2 SEKSI FM TUBAN','7303','PL Plant Tuban II','FINISH_MILL','Finish Mill 1',61,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311054','FINISH MILL 2 T2 SEKSI FM TUBAN','7303','PL Plant Tuban II','FINISH_MILL','Finish Mill 2',62,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121013','CRUSHER BT. KAPUR TUBAN3','7304','PL Plant Tuban III','CRUSHER_BK','Crusher BK',10,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121023','CRUSHER TNH LIAT TUBAN3','7304','PL Plant Tuban III','CRUSHER_TL','Crusher TL',20,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213033','RAW MILL TBN3 - SEKSI RKC3','7304','PL Plant Tuban III','RAW_MEAL','Raw Meal',30,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213073','COAL MILL TBN3 - SEKSI RKC3','7304','PL Plant Tuban III','FINE_COAL','Fine Coal',40,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213043','KILN TBN3 - SEKSI RKC3','7304','PL Plant Tuban III','KILN','Kiln',50,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313055','FINISH MILL 1 T3 SEKSI FM TBN34','7304','PL Plant Tuban III','FINISH_MILL','Finish Mill 1',61,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313056','FINISH MILL 2 T3 SEKSI FM TBN34','7304','PL Plant Tuban III','FINISH_MILL','Finish Mill 2',62,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121014','CRUSHER BT. KAPUR TUBAN4','7305','PL Plant Tuban IV','CRUSHER_BK','Crusher BK',10,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121024','CRUSHER TNH LIAT TUBAN4','7305','PL Plant Tuban IV','CRUSHER_TL','Crusher TL',20,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511034','RAW MILL TBN4 SEKSI RKC4','7305','PL Plant Tuban IV','RAW_MEAL','Raw Meal',30,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511074','COAL MILL TUBAN4 - SEKSI RKC4','7305','PL Plant Tuban IV','FINE_COAL','Fine Coal',40,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511044','KILN TUBAN4 - SEKSI RKC4','7305','PL Plant Tuban IV','KILN','Kiln',50,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313057','FINISH MILL 1 T4 SEKSI FM TBN34','7305','PL Plant Tuban IV','FINISH_MILL','Finish Mill 1',61,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313058','FINISH MILL 2 T4 SEKSI FM TBN34','7305','PL Plant Tuban IV','FINISH_MILL','Finish Mill 2',62,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203141081','SEKSI OPERASI WHRPG','7305','PL Plant Tuban IV','WHRPG','WHRPG',70,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7503351051','FINISH MILL CIGADING SIE OP GP CIGADING','7308','PL Plant Cigading (SG)','FINISH_MILL','Finish Mill',60,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341061','PACKER GSK CURAH S. OP FM GRESIK','7401','GP Gresik','PACKER_CURAH','Packer Curah',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341062','PACKER GSK BAG S. OP FM GRESIK','7401','GP Gresik','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341063','PACKER JUMBO BAG S. OP FM GRESIK','7401','GP Gresik','PACKER_JUMBO','Packer Jumbo Bag',95,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312061','PACKER T1 CRH SIE PACKER & PELB TBN','7403','CP Tuban','PACKER_CURAH','Packer Curah T1',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312062','PACKER T2 CRH SIE PACKER & PELB TBN','7403','CP Tuban','PACKER_CURAH','Packer Curah T2',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312063','PACKER T3 CRH SIE PACKER & PELB TBN','7403','CP Tuban','PACKER_CURAH','Packer Curah T3',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312067','PACKER T4 CRH SIE PACKER & PELB TBN','7403','CP Tuban','PACKER_CURAH','Packer Curah T4',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312064','PACKER T1 BAG S. PACKER & PELB TBN','7403','CP Tuban','PACKER_BAG','Packer Bag T1',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312065','PACKER T2 BAG S. PACKER & PELB TBN','7403','CP Tuban','PACKER_BAG','Packer Bag T2',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312066','PACKER T3 BAG S. PACKER & PELB TBN','7403','CP Tuban','PACKER_BAG','Packer Bag T3',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312068','PACKER T4 BAG S. PACKER & PELB TBN','7403','CP Tuban','PACKER_BAG','Packer Bag T4',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213001','PACKING PLAN CIWANDAN CURAH','7405','PP Ciwandan','PACKER_CURAH','Packer Curah',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213002','PACKING PLAN CIWANDAN BAG','7405','PP Ciwandan','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213003','PP CELUKAN BAWANG CURAH','7406','PP Celukan Bawang','PACKER_CURAH','Packer Curah',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213004','PP CELUKAN BAWANG BAG','7406','PP Celukan Bawang','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213005','PACKING PLAN BANYUWANGI CURAH','7408','PP Banyuwangi','PACKER_CURAH','Packer Curah',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213006','PACKING PLAN BANYUWANGI BAG','7408','PP Banyuwangi','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213009','PP PONTIANAK CURAH (ST)','7412','PP Pontianak','PACKER_CURAH','Packer Curah',80,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213010','PACKING PLAN PONTIANAK BAG (ST)','7412','PP Pontianak','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7503351061','PACKER CIGADING SIE OP GP CIGADING','7415','GP Cigading (SG)','PACKER','Packer',85,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7503351062','PACKER BAG CIGADING SIE OP GP CIGADING','7415','GP Cigading (SG)','PACKER_BAG','Packer Bag',90,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7304213003','GP PELB. GRESIK','7608','DC Pelabuhan Gresik','DISTRIBUTION_GP','Distribution / GP',100,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7304213012','GP TANJUNG PRIOK (SP)','7609','PP Tanjung Priok','DISTRIBUTION_GP','Distribution / GP',100,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7304213010','GP CIWANDAN SP','7611','DC Ciwandan','DISTRIBUTION_GP','Distribution / GP',100,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7304213043','GP Jombor SID','7642','VP Pelsus Tuban','DISTRIBUTION_GP','Distribution / GP',100,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("receiverCc") DO UPDATE SET "receiverDescription"=EXCLUDED."receiverDescription", "plantCode"=EXCLUDED."plantCode", "plantName"=EXCLUDED."plantName", "processCode"=EXCLUDED."processCode", "processLabel"=EXCLUDED."processLabel", "displayOrder"=EXCLUDED."displayOrder", "active"=EXCLUDED."active", "updatedAt"=CURRENT_TIMESTAMP;

-- Reference proposals retain their explicit governance status; PROPOSED is not promoted to VALIDATED.
INSERT INTO "cost_cycle_references" ("receiverCc","peerGroup","preferredReferenceCc","fallbackReferenceCcs","confidence","reviewStatus","notes","active","createdAt","updatedAt") VALUES
('7103341051','FINISH_MILL_STANDALONE','7503351051','["7203311051"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121011','CRUSHER_LIMESTONE_TUBAN','7203121012','["7203121013", "7203121014"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121021','CRUSHER_CLAY_TUBAN','7203121022','["7203121023"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211031','RAW_MILL_TUBAN','7203212032','["7203213033"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211071','COAL_MILL_TUBAN','7203212072','["7203213073"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203210071','COAL_MILL_SPECIAL_TUBAN','7203211071','["7203212072"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203211041','KILN_TUBAN','7203212042','["7203213043"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311051','FINISH_MILL_TUBAN_I','7203311052','["7203311059"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311052','FINISH_MILL_TUBAN_I','7203311051','["7203311059", "7203311053"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311059','FINISH_MILL_TUBAN_I','7203311051','["7203311053"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121012','CRUSHER_LIMESTONE_TUBAN','7203121013','["7203121014"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121022','CRUSHER_CLAY_TUBAN','7203121023','["7203121024"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212032','RAW_MILL_TUBAN','7203213033','["7203211031"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212072','COAL_MILL_TUBAN','7203211071','["7203213073"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203212042','KILN_TUBAN','7203213043','["7203511044"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311053','FINISH_MILL_TUBAN_II','7203311054','["7203311051"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203311054','FINISH_MILL_TUBAN_II','7203311053','["7203311051", "7203311059"]','Validated','VALIDATED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121013','CRUSHER_LIMESTONE_TUBAN','7203121012','["7203121014"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121023','CRUSHER_CLAY_TUBAN','7203121024','["7203121022"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213033','RAW_MILL_TUBAN','7203212032','["7203511034"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213073','COAL_MILL_TUBAN','7203212072','["7203211071"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203213043','KILN_TUBAN','7203511044','["7203212042"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313055','FINISH_MILL_TUBAN_III','7203313056','["7203313057"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313056','FINISH_MILL_TUBAN_III','7203313055','["7203313058"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121014','CRUSHER_LIMESTONE_TUBAN','7203121013','["7203121012"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203121024','CRUSHER_CLAY_TUBAN','7203121023','["7203121022"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511034','RAW_MILL_TUBAN','7203213033','["7203212032"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511074','COAL_MILL_TUBAN','7203213073','["7203212072"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203511044','KILN_TUBAN','7203213043','["7203212042"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313057','FINISH_MILL_TUBAN_IV','7203313058','["7203313055"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203313058','FINISH_MILL_TUBAN_IV','7203313057','["7203313055"]','High','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203141081','WHRPG_UNIQUE',NULL,'[]','Manual','MANUAL_REQUIRED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7503351051','FINISH_MILL_STANDALONE','7103341051','["7203311051", "7203311053"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341061','PACKER_CURAH_STANDALONE','7103341062','["7503351061"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7103341062','PACKER_BAG_STANDALONE','7103341061','["7503351061"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312061','PACKER_CURAH_TUBAN','7203312062','["7203312063"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312062','PACKER_CURAH_TUBAN','7203312061','["7203312063", "7203312067"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312063','PACKER_CURAH_TUBAN','7203312067','["7203312061"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7203312067','PACKER_CURAH_TUBAN','7203312063','["7203312061"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213001','PACKING_CURAH_EXTERNAL','7404213003','["7404213005"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213003','PACKING_CELUKAN_BAWANG','7404213004','["7404213001"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213004','PACKING_CELUKAN_BAWANG','7404213003','["7404213001", "7404213005"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213005','PACKING_CURAH_EXTERNAL','7404213003','["7404213001"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7404213009','PACKING_CURAH_EXTERNAL','7404213005','["7404213003"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('7503351061','PACKER_CURAH_STANDALONE','7103341061','["7203312061", "7203312063"]','Medium','PROPOSED','Copy preferred active reference by Cycle + Segment name. Fallbacks only when preferred cannot be used. No automatic self-history.',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("receiverCc") DO UPDATE SET "peerGroup"=EXCLUDED."peerGroup", "preferredReferenceCc"=EXCLUDED."preferredReferenceCc", "fallbackReferenceCcs"=EXCLUDED."fallbackReferenceCcs", "confidence"=EXCLUDED."confidence", "reviewStatus"=EXCLUDED."reviewStatus", "notes"=EXCLUDED."notes", "active"=EXCLUDED."active", "updatedAt"=CURRENT_TIMESTAMP;
