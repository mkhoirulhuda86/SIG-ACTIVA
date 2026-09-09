import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { costStructureStorage } from "@/lib/cost-structure/storage/supabase-storage";
import { runCycleEngine } from "../engine";
import { generateCycleWorkbooks } from "../export";
import type {
  CycleCcMaster,
  CycleReferenceConfig,
  CycleSourceRow,
  CycleTargetChange,
} from "../contracts";

export class CycleWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

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

export async function previewCycle(input: {
  fiscalYear: number;
  fiscalPeriod: number;
  targets: CycleTargetChange[];
}) {
  const state = await loadActiveCycle(input.fiscalYear, input.fiscalPeriod);
  const result = runCycleEngine(
    state.rows,
    state.ccMaster,
    input.targets,
    state.references,
  );
  const masterByCc = new Map(state.ccMaster.map((m) => [m.receiverCc, m]));
  return {
    state,
    result,
    changes: result.actions
      .filter((a) => a.action !== "NO_CHANGE")
      .map((a) => ({ ...masterByCc.get(a.receiverCc), ...a })),
  };
}

export async function generateCycle(input: {
  fiscalYear: number;
  fiscalPeriod: number;
  expectedUploadId: number;
  expectedVersion: number;
  expectedHash: string;
  expectedMasterFingerprint: string;
  targets: CycleTargetChange[];
  userId: number;
}) {
  const preview = await previewCycle(input);
  const { upload, fingerprint } = preview.state;
  if (
    upload.id !== input.expectedUploadId ||
    upload.version !== input.expectedVersion ||
    upload.fileHashSha256 !== input.expectedHash
  )
    throw new CycleWorkflowError(
      "Source aktif berubah. Lakukan preview ulang.",
      "STALE_ACTIVE_UPLOAD",
    );
  if (fingerprint !== input.expectedMasterFingerprint)
    throw new CycleWorkflowError(
      "Master/reference berubah. Lakukan preview ulang.",
      "STALE_CONFIGURATION",
    );
  if (preview.result.generationBlocked)
    throw new CycleWorkflowError(
      "Generation diblokir oleh validation error.",
      "GENERATION_BLOCKED",
      422,
    );
  if (preview.changes.length === 0)
    throw new CycleWorkflowError(
      "Tidak ada perubahan aktual untuk dihasilkan.",
      "NO_CHANGES",
      422,
    );
  const outputs = await generateCycleWorkbooks(
    preview.result.deltaByCycle,
    input,
  );
  const stored: Array<
    (typeof outputs)[number] & { hash: string; storageKey: string }
  > = [];
  try {
    for (const output of outputs) {
      const storageKey = `cycle/generated/${input.fiscalYear}/${String(input.fiscalPeriod).padStart(2, "0")}/${randomUUID()}-${output.fileName}`;
      await costStructureStorage.upload(
        storageKey,
        output.buffer,
        output.contentType,
      );
      stored.push({
        ...output,
        storageKey,
        hash: createHash("sha256").update(output.buffer).digest("hex"),
      });
    }
    const run = await prisma.costCycleChangeRun.create({
      data: {
        uploadId: upload.id,
        sourceVersion: upload.version,
        sourceHashSha256: upload.fileHashSha256,
        masterFingerprint: fingerprint,
        changedCcCount: preview.changes.length,
        warningCount: preview.result.issues.filter(
          (i) => i.severity === "WARNING",
        ).length,
        generatedById: input.userId,
        changes: {
          create: preview.changes.map((c) => ({
            receiverCc: c.receiverCc,
            baselineStatus: c.baselineStatus,
            targetStatus: c.targetStatus,
            action: c.action,
            referenceCc: c.referenceCc,
            referenceSource: c.referenceSource,
            referenceReviewStatus: c.referenceReviewStatus,
            referenceConfidence: c.referenceConfidence,
            fixedAffectedRows: c.fixedAffectedRows,
            variableAffectedRows: c.variableAffectedRows,
            issueSummaryJson: preview.result.issues.filter(
              (i) => i.receiverCc === c.receiverCc,
            ) as Prisma.InputJsonValue,
          })),
        },
        files: {
          create: stored.map((f) => ({
            cycle: f.cycle,
            fileName: f.fileName,
            rowCount: f.rowCount,
            fileHashSha256: f.hash,
            storageKey: f.storageKey,
          })),
        },
      },
      include: { files: true },
    });
    return run;
  } catch (error) {
    await Promise.all(
      stored.map((f) =>
        costStructureStorage.remove(f.storageKey).catch(() => undefined),
      ),
    );
    throw error;
  }
}
