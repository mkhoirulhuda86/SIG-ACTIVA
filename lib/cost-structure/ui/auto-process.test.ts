import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockedActionLabel, friendlyStageError, shouldAutoAdvance, stageStatusLabel } from '../../../components/cost-structure/process/presentation';
import type { CostStructureProcess, ProcessStage } from '../../../components/cost-structure/process/types';

const stage = (status: ProcessStage['status'], extra: Partial<ProcessStage> = {}): ProcessStage => ({ key: 'RECONCILIATION', title: 'Source reconciliation', status, ...extra });
const process = (overallStatus: CostStructureProcess['overallStatus'], extra: Partial<CostStructureProcess> = {}): CostStructureProcess => ({ uploadId: 4, periodId: 7, overallStatus, currentStage: 'RECONCILIATION', stages: [stage('WAITING')], canAdvance: false, canRetry: false, readyForFinalization: false, ...extra });

test('stage rendering supports every process contract state', () => {
  assert.deepEqual(['COMPLETED', 'RUNNING', 'WAITING', 'BLOCKED', 'NOT_APPLICABLE'].map((status) => stageStatusLabel(status as ProcessStage['status'])), ['Selesai', 'Sedang diproses...', 'Menunggu', 'Terhenti', 'Tidak diperlukan']);
});

test('blocked stage uses mapping action and concise reconciliation error', () => {
  const blocked = stage('BLOCKED', { errorCode: 'UNMAPPED_COA', message: 'Mapping belum lengkap' });
  assert.equal(blockedActionLabel(blocked), 'Perbaiki mapping');
  assert.equal(friendlyStageError(blocked).title, 'Rekonsiliasi gagal');
});

test('automatic advance runs only for advanceable non-blocked, non-finalized states', () => {
  assert.equal(shouldAutoAdvance(process('PROCESSING', { canAdvance: true })), true);
  assert.equal(shouldAutoAdvance(process('BLOCKED', { canAdvance: true })), false);
  assert.equal(shouldAutoAdvance(process('FINALIZED', { canAdvance: true })), false);
});

test('runner prevents duplicate advance and offers bounded network retry', () => {
  const source = readFileSync('components/cost-structure/process/process-workflow.tsx', 'utf8');
  assert.match(source, /if \(requestInFlight\.current\) return/);
  assert.match(source, /NETWORK_BACKOFF_MS/);
  assert.match(source, /onRetry=\{advance\}/);
});

test('business 409 updates authoritative state and hard-stops automatic no-progress retries', () => {
  const api = readFileSync('components/cost-structure/process/api.ts', 'utf8');
  const runner = readFileSync('components/cost-structure/process/process-workflow.tsx', 'utf8');
  assert.match(api, /if \(process\)[\s\S]*process,[\s\S]*false/);
  assert.match(runner, /if \(e\.process\) \{[\s\S]*update\(e\.process\)[\s\S]*networkAttempt\.current = NETWORK_BACKOFF_MS\.length/);
  assert.match(runner, /Tahap proses belum dapat dilanjutkan/);
});

test('admin historical audit maintenance uses the approved route and exact upload guard', () => {
  const runner = readFileSync('components/cost-structure/process/process-workflow.tsx', 'utf8');
  const route = readFileSync('app/api/cost-structure/periods/[id]/hydrate-audit/route.ts', 'utf8');
  assert.match(runner, /isAdmin\(role\)/);
  assert.match(runner, /\{admin && <div/);
  assert.match(runner, /Refresh referensi export/);
  assert.match(runner, /JSON\.stringify\(\{ expectedUploadId: uploadId \}\)/);
  assert.match(route, /expectedUploadId/);
  assert.match(route, /hydrateAuditSnapshot\(Number\(\(await params\)\.id\), auth\.user\.uid, expectedUploadId\)/);
});

test('automatic workflow is primary; manual reconciliation is not exposed as a normal action', () => {
  const source = readFileSync('app/cost-structure/upload/[id]/phase-d-workspace.tsx', 'utf8');
  assert.match(source, /<ProcessWorkflow uploadId=\{uploadId\}/);
  assert.doesNotMatch(source, /Run reconciliation/);
  assert.match(source, /Revalidate file/);
});

test('READY and FINALIZED summaries render without automatic finalization', () => {
  const tracker = readFileSync('components/cost-structure/process/process-tracker.tsx', 'utf8');
  const runner = readFileSync('components/cost-structure/process/process-workflow.tsx', 'utf8');
  assert.match(tracker, /Seluruh proses otomatis selesai\. Periode siap untuk Finalisasi\./);
  assert.match(tracker, /Cost Structure telah difinalisasi/);
  assert.doesNotMatch(runner.match(/useEffect\([\s\S]*?\}, \[advance, process, error\]\)/)?.[0] ?? '', /finalize/);
});

test('finalize is visible only from authoritative readiness', () => {
  assert.equal(process('READY', { readyForFinalization: true }).readyForFinalization, true);
  const source = readFileSync('components/cost-structure/process/process-tracker.tsx', 'utf8');
  assert.match(source, /process\.readyForFinalization && process\.overallStatus !== 'FINALIZED'/);
});

test('mobile-safe layout and technical error disclosure are present', () => {
  const source = readFileSync('components/cost-structure/process/process-tracker.tsx', 'utf8');
  assert.match(source, /min-w-0/);
  assert.match(source, /max-w-full overflow-auto/);
  assert.match(source, /<details className="mt-3 text-sm"><summary[^>]*>Technical detail/);
  const technical = friendlyStageError(stage('BLOCKED', { message: 'PrismaClient error while querying' }));
  assert.notEqual(technical.message, technical.technicalDetail);
});
