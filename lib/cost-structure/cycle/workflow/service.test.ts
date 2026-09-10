import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runCycleEngine } from "../engine";
import type { CycleCcMaster, CycleReferenceConfig, CycleSourceRow } from "../contracts";
import { createCycleWorkflow, CycleWorkflowError } from "./core";

const TARGET = "7203311054";
const REFERENCE = "7203311053";
const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

const master = (receiverCc: string): CycleCcMaster => ({
  receiverCc, receiverDescription: receiverCc, plantCode: "7303", plantName: "Synthetic Plant",
  processCode: "FINISH", processLabel: "Finish Mill", displayOrder: receiverCc === TARGET ? 2 : 1, active: true,
});
const row = (sourceOrder: number, cycle: "7FT1GF" | "7VT1GF", segmentName: string, receiverCc: string, portion: number): CycleSourceRow => ({
  sourceOrder, sourceRowNumber: sourceOrder + 1, cycle, segmentName, receiverCc, portion,
  startDate: receiverCc === TARGET ? "2026-08-01" : "2025-01-01",
});
const rows: CycleSourceRow[] = [
  row(1, "7FT1GF", "FIX-A", TARGET, 0), row(2, "7VT1GF", "VAR-A", TARGET, 0),
  row(3, "7FT1GF", "FIX-A", REFERENCE, 12.5), row(4, "7VT1GF", "VAR-A", REFERENCE, 7.25),
];
const reference: CycleReferenceConfig = {
  receiverCc: TARGET, peerGroup: "SYNTHETIC", preferredReferenceCc: REFERENCE,
  fallbackReferenceCcs: [], confidence: "Validated", reviewStatus: "VALIDATED", active: true,
};

function harness(options: { rows?: CycleSourceRow[]; upload?: Partial<{ id: number; version: number; fileHashSha256: string }>; fingerprint?: string; failPersistence?: boolean } = {}) {
  const uploaded: Array<{ key: string; bytes: Uint8Array }> = [];
  const removed: string[] = [];
  const persisted: unknown[] = [];
  let engineCalls = 0;
  let exporterInput: unknown;
  const state = {
    upload: { id: 41, version: 3, fileHashSha256: "source-hash", ...options.upload },
    rows: options.rows ?? rows, sourceSheetName: "Synthetic", ccMaster: [master(TARGET), master(REFERENCE)],
    references: [reference], fingerprint: options.fingerprint ?? "master-fingerprint",
  };
  const workflow = createCycleWorkflow({
    loadActiveCycle: async () => state as never,
    runEngine: (...args) => { engineCalls += 1; return runCycleEngine(...args); },
    generateWorkbooks: async (input) => {
      exporterInput = input;
      const split = input as unknown as { fixed: CycleSourceRow[]; variable: CycleSourceRow[] };
      return [
        ...(split.fixed.length ? [{ cycle: "7FT1GF" as const, fileName: "fixed.xlsx", contentType, buffer: new Uint8Array([1, 2]), rowCount: split.fixed.length }] : []),
        ...(split.variable.length ? [{ cycle: "7VT1GF" as const, fileName: "variable.xlsx", contentType, buffer: new Uint8Array([3, 4]), rowCount: split.variable.length }] : []),
      ];
    },
    uploadGenerated: async (key, bytes) => { uploaded.push({ key, bytes }); },
    removeGenerated: async (key) => { removed.push(key); },
    createStorageKey: (_year, _period, fileName) => `generated/${fileName}`,
    createRun: async (input) => {
      persisted.push(input);
      if (options.failPersistence) throw new Error("synthetic persistence failure");
      return { id: 91, files: input.stored.map((file, id) => ({ id, ...file })) };
    },
  });
  const input = { fiscalYear: 2026, fiscalPeriod: 8, expectedUploadId: 41, expectedVersion: 3,
    expectedHash: "source-hash", expectedMasterFingerprint: "master-fingerprint",
    targets: [{ receiverCc: TARGET, targetStatus: "ON" as const }], userId: 77 };
  return { workflow, input, uploaded, removed, persisted, get engineCalls() { return engineCalls; }, get exporterInput() { return exporterInput; } };
}

test("synthetic golden workflow recalculates and hands exact Fixed and Variable target deltas to exporter", async () => {
  const h = harness();
  await h.workflow.preview(h.input);
  const run = await h.workflow.generate(h.input) as { id: number };
  assert.equal(h.engineCalls, 2, "generation must run the authoritative engine again");
  assert.equal(run.id, 91);
  assert.deepEqual(h.exporterInput, {
    fixed: [{ cycle: "7FT1GF", startDate: "2026-08-01", segmentName: "FIX-A", receiverCc: TARGET, portion: 12.5, sourceOrder: 1 }],
    variable: [{ cycle: "7VT1GF", startDate: "2026-08-01", segmentName: "VAR-A", receiverCc: TARGET, portion: 7.25, sourceOrder: 2 }],
  });
});

test("generation rejects changed active upload identity, version, or hash before export", async (t) => {
  for (const [name, upload] of [["identity", { id: 42 }], ["version", { version: 4 }], ["hash", { fileHashSha256: "new" }]] as const) {
    await t.test(name, async () => {
      const h = harness({ upload });
      await assert.rejects(h.workflow.generate(h.input), (error: unknown) => error instanceof CycleWorkflowError && error.code === "STALE_ACTIVE_UPLOAD");
      assert.equal(h.uploaded.length, 0);
    });
  }
});

test("generation rejects changed configuration fingerprint before export", async () => {
  const h = harness({ fingerprint: "changed" });
  await assert.rejects(h.workflow.generate(h.input), (error: unknown) => error instanceof CycleWorkflowError && error.code === "STALE_CONFIGURATION");
  assert.equal(h.uploaded.length, 0);
});

test("blocked calculation creates neither workbook nor successful run", async () => {
  const h = harness({ rows: rows.filter((item) => item.receiverCc === TARGET) });
  await assert.rejects(h.workflow.generate(h.input), (error: unknown) => error instanceof CycleWorkflowError && error.code === "GENERATION_BLOCKED");
  assert.equal(h.uploaded.length, 0); assert.equal(h.persisted.length, 0);
});

test("no actual changes are rejected before export", async () => {
  const h = harness();
  await assert.rejects(h.workflow.generate({ ...h.input, targets: [{ receiverCc: TARGET, targetStatus: "OFF" }] }),
    (error: unknown) => error instanceof CycleWorkflowError && error.code === "NO_CHANGES");
  assert.equal(h.uploaded.length, 0);
});

test("generation emits only the cycle that has target rows", async (t) => {
  for (const [name, omitted, expected] of [["Fixed only", "7VT1GF", "7FT1GF"], ["Variable only", "7FT1GF", "7VT1GF"]] as const) {
    await t.test(name, async () => {
      const h = harness({ rows: rows.filter((item) => item.cycle !== omitted) });
      await h.workflow.generate(h.input);
      assert.deepEqual(h.uploaded.map((item) => item.key), [`generated/${expected === "7FT1GF" ? "fixed" : "variable"}.xlsx`]);
    });
  }
});

test("two-cycle generation stores exporter metadata, SHA-256, storage key, and linked audit details", async () => {
  const h = harness();
  await h.workflow.generate(h.input);
  const audit = h.persisted[0] as {
    upload: { id: number; version: number; fileHashSha256: string }; fingerprint: string; userId: number;
    changes: Array<{ baselineStatus: string; targetStatus: string; action: string; referenceCc?: string;
      referenceSource?: string; referenceReviewStatus?: string; fixedAffectedRows: number; variableAffectedRows: number }>;
    stored: Array<{ cycle: string; fileName: string; rowCount: number; hash: string; storageKey: string }>;
  };
  assert.deepEqual({ uploadId: audit.upload.id, sourceVersion: audit.upload.version, sourceHash: audit.upload.fileHashSha256,
    fingerprint: audit.fingerprint, userId: audit.userId, changedCcCount: audit.changes.length },
  { uploadId: 41, sourceVersion: 3, sourceHash: "source-hash", fingerprint: "master-fingerprint", userId: 77, changedCcCount: 1 });
  assert.deepEqual({ baselineStatus: audit.changes[0].baselineStatus, targetStatus: audit.changes[0].targetStatus,
    action: audit.changes[0].action, referenceCc: audit.changes[0].referenceCc, referenceSource: audit.changes[0].referenceSource,
    review: audit.changes[0].referenceReviewStatus, fixed: audit.changes[0].fixedAffectedRows, variable: audit.changes[0].variableAffectedRows },
  { baselineStatus: "OFF", targetStatus: "ON", action: "TURN_ON", referenceCc: REFERENCE, referenceSource: "PREFERRED", review: "VALIDATED", fixed: 1, variable: 1 });
  assert.deepEqual(audit.stored.map((file) => ({ cycle: file.cycle, fileName: file.fileName, rowCount: file.rowCount, hash: file.hash, storageKey: file.storageKey })), [
    { cycle: "7FT1GF", fileName: "fixed.xlsx", rowCount: 1, hash: createHash("sha256").update(new Uint8Array([1, 2])).digest("hex"), storageKey: "generated/fixed.xlsx" },
    { cycle: "7VT1GF", fileName: "variable.xlsx", rowCount: 1, hash: createHash("sha256").update(new Uint8Array([3, 4])).digest("hex"), storageKey: "generated/variable.xlsx" },
  ]);
});

test("persistence failure cleans up every newly stored generated object", async () => {
  const h = harness({ failPersistence: true });
  await assert.rejects(h.workflow.generate(h.input), /synthetic persistence failure/);
  assert.deepEqual(h.removed.sort(), ["generated/fixed.xlsx", "generated/variable.xlsx"]);
});
