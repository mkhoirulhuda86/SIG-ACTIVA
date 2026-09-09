import { createHash } from "node:crypto";
import { runCycleEngine, type CycleEngineResult } from "../engine";
import { generateCycleWorkbooks, type GeneratedCycleWorkbook } from "../export";
import type { CycleCcMaster, CycleReferenceConfig, CycleSourceRow, CycleTargetChange } from "../contracts";

export class CycleWorkflowError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}

export type ActiveCycleState = {
  upload: { id: number; version: number; fileHashSha256: string; [key: string]: unknown };
  rows: CycleSourceRow[]; sourceSheetName: string | null; ccMaster: CycleCcMaster[];
  references: CycleReferenceConfig[]; fingerprint: string;
};
type StoredCycleWorkbook = GeneratedCycleWorkbook & {
  hash: string;
  storageKey: string;
};

export type CycleWorkflowDependencies<Run> = {
  loadActiveCycle: (fiscalYear: number, fiscalPeriod: number) => Promise<ActiveCycleState>;
  runEngine: typeof runCycleEngine;
  generateWorkbooks: typeof generateCycleWorkbooks;
  uploadGenerated: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  removeGenerated: (key: string) => Promise<void>;
  createRun: (input: {
    upload: ActiveCycleState["upload"];
    fingerprint: string;
    changes: ReturnType<typeof buildChangedCcSummary>;
    result: CycleEngineResult;
    stored: StoredCycleWorkbook[];
    userId: number;
  }) => Promise<Run>;
  createStorageKey: (fiscalYear: number, fiscalPeriod: number, fileName: string) => string;
};

function buildChangedCcSummary(
  result: CycleEngineResult,
  ccMaster: readonly CycleCcMaster[],
) {
  const masterByCc = new Map(ccMaster.map((m) => [m.receiverCc, m]));
  return result.actions
    .filter((action) => action.action !== "NO_CHANGE")
    .map((action) => ({ ...masterByCc.get(action.receiverCc), ...action }));
}

export function createCycleWorkflow<Run>(dependencies: CycleWorkflowDependencies<Run>) {
  const preview = async (input: {
    fiscalYear: number;
    fiscalPeriod: number;
    targets: CycleTargetChange[];
  }) => {
    const state = await dependencies.loadActiveCycle(input.fiscalYear, input.fiscalPeriod);
    const result = dependencies.runEngine(state.rows, state.ccMaster, input.targets, state.references);
    return { state, result, changes: buildChangedCcSummary(result, state.ccMaster) };
  };

  const generate = async (input: {
    fiscalYear: number;
    fiscalPeriod: number;
    expectedUploadId: number;
    expectedVersion: number;
    expectedHash: string;
    expectedMasterFingerprint: string;
    targets: CycleTargetChange[];
    userId: number;
  }) => {
    // Intentionally recalculate from authoritative state; no preview delta is accepted.
    const calculated = await preview(input);
    const { upload, fingerprint } = calculated.state;
    if (upload.id !== input.expectedUploadId || upload.version !== input.expectedVersion || upload.fileHashSha256 !== input.expectedHash)
      throw new CycleWorkflowError("Source aktif berubah. Lakukan preview ulang.", "STALE_ACTIVE_UPLOAD");
    if (fingerprint !== input.expectedMasterFingerprint)
      throw new CycleWorkflowError("Master/reference berubah. Lakukan preview ulang.", "STALE_CONFIGURATION");
    if (calculated.result.generationBlocked)
      throw new CycleWorkflowError("Generation diblokir oleh validation error.", "GENERATION_BLOCKED", 422);
    if (calculated.changes.length === 0)
      throw new CycleWorkflowError("Tidak ada perubahan aktual untuk dihasilkan.", "NO_CHANGES", 422);

    const outputs = await dependencies.generateWorkbooks(calculated.result.deltaByCycle, input);
    const stored: StoredCycleWorkbook[] = [];
    try {
      for (const output of outputs) {
        const storageKey = dependencies.createStorageKey(input.fiscalYear, input.fiscalPeriod, output.fileName);
        await dependencies.uploadGenerated(storageKey, output.buffer, output.contentType);
        stored.push({ ...output, storageKey, hash: createHash("sha256").update(output.buffer).digest("hex") });
      }
      return await dependencies.createRun({ upload, fingerprint, changes: calculated.changes, result: calculated.result, stored, userId: input.userId });
    } catch (error) {
      await Promise.all(stored.map((file) => dependencies.removeGenerated(file.storageKey).catch(() => undefined)));
      throw error;
    }
  };

  return { preview, generate };
}
