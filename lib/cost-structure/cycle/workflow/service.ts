import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { costStructureStorage } from "@/lib/cost-structure/storage/supabase-storage";
import { runCycleEngine } from "../engine";
import { generateCycleWorkbooks } from "../export";
import { createCycleWorkflow, CycleWorkflowError } from "./core";
export { CycleWorkflowError } from "./core";
import type {
  CycleCcMaster,
  CycleReferenceConfig,
  CycleSourceRow,
} from "../contracts";

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const jsonArray = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

async function loadConfiguration() {
  const [masters, refs] = await Promise.all([
    prisma.costCycleCcMaster.findMany({
      where: { active: true },
      orderBy: [
        { plantCode: "asc" },
        { displayOrder: "asc" },
        { receiverCc: "asc" },
      ],
    }),
    prisma.costCycleReference.findMany({
      where: { active: true },
      orderBy: { receiverCc: "asc" },
    }),
  ]);
  const ccMaster: CycleCcMaster[] = masters.map((m) => ({ ...m }));
  const references: CycleReferenceConfig[] = refs.map((r) => ({
    ...r,
    preferredReferenceCc: r.preferredReferenceCc ?? undefined,
    confidence: r.confidence as CycleReferenceConfig["confidence"],
    reviewStatus: r.reviewStatus,
    fallbackReferenceCcs: jsonArray(r.fallbackReferenceCcs),
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ masters: ccMaster, references }))
    .digest("hex");
  return { ccMaster, references, fingerprint };
}

export async function loadActiveCycle(
  fiscalYear: number,
  fiscalPeriod: number,
) {
  const upload = await prisma.costCycleUpload.findFirst({
    where: {
      isActiveVersion: true,
      status: "VALIDATED",
      period: { fiscalYear, fiscalPeriod },
    },
    include: { period: true },
    orderBy: { version: "desc" },
  });
  if (!upload)
    throw new CycleWorkflowError(
      "Belum ada upload Cycle valid yang aktif untuk periode ini.",
      "ACTIVE_UPLOAD_NOT_FOUND",
      404,
    );
  const dbRows = await prisma.costCycleSourceRow.findMany({
    where: { uploadId: upload.id },
    select: {
      sourceRowNumber: true,
      sourceOrder: true,
      sourceSheetName: true,
      cycle: true,
      startDate: true,
      segmentName: true,
      receiverCc: true,
      portion: true,
    },
    orderBy: { sourceOrder: "asc" },
  });
  const rows: CycleSourceRow[] = dbRows.map((r) => ({
    sourceRowNumber: r.sourceRowNumber,
    sourceOrder: r.sourceOrder,
    cycle: r.cycle as CycleSourceRow["cycle"],
    startDate: dateOnly(r.startDate),
    segmentName: r.segmentName,
    receiverCc: r.receiverCc,
    portion: r.portion.toNumber(),
  }));
  const config = await loadConfiguration();
  return {
    upload,
    rows,
    sourceSheetName: dbRows[0]?.sourceSheetName ?? null,
    ...config,
  };
}

const productionWorkflow = createCycleWorkflow({
  loadActiveCycle,
  runEngine: runCycleEngine,
  generateWorkbooks: generateCycleWorkbooks,
  uploadGenerated: (key, bytes, contentType) => costStructureStorage.upload(key, bytes, contentType),
  removeGenerated: (key) => costStructureStorage.remove(key),
  createStorageKey: (year, period, fileName) => `cycle/generated/${year}/${String(period).padStart(2, "0")}/${randomUUID()}-${fileName}`,
  createRun: async ({ upload, fingerprint, changes, result, stored, userId }) => prisma.costCycleChangeRun.create({
    data: {
      uploadId: upload.id, sourceVersion: upload.version, sourceHashSha256: upload.fileHashSha256,
      masterFingerprint: fingerprint, changedCcCount: changes.length,
      warningCount: result.issues.filter((issue) => issue.severity === "WARNING").length,
      generatedById: userId,
      changes: { create: changes.map((change) => ({
        receiverCc: change.receiverCc, baselineStatus: change.baselineStatus, targetStatus: change.targetStatus,
        action: change.action, referenceCc: change.referenceCc, referenceSource: change.referenceSource,
        referenceReviewStatus: change.referenceReviewStatus, referenceConfidence: change.referenceConfidence,
        fixedAffectedRows: change.fixedAffectedRows, variableAffectedRows: change.variableAffectedRows,
        issueSummaryJson: result.issues.filter((issue) => issue.receiverCc === change.receiverCc) as Prisma.InputJsonValue,
      })) },
      files: { create: stored.map((file) => ({ cycle: file.cycle, fileName: file.fileName, rowCount: file.rowCount, fileHashSha256: file.hash, storageKey: file.storageKey })) },
    },
    include: { files: true },
  }),
});

export const previewCycle = productionWorkflow.preview;
export const generateCycle = productionWorkflow.generate;
