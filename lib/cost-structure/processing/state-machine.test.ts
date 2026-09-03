import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveProcessStatus, executeNextProcessStage, type ProcessingSnapshot } from './state-machine';

const base = (overrides: Partial<ProcessingSnapshot> = {}): ProcessingSnapshot => ({
  uploadId: 41,
  periodId: 7,
  uploadActive: true,
  uploadStatus: 'VALIDATED',
  periodStatus: 'SOURCE_VALIDATION',
  validationBlockers: [],
  reconciliationReady: false,
  reconciliationBlockers: [],
  auditReady: true,
  auditMissing: [],
  calculation: null,
  postCheckBlockers: [],
  ...overrides,
});

test('validated upload advances next to reconciliation', () => {
  const status = deriveProcessStatus(base());
  assert.equal(status.currentStage, 'RECONCILIATION');
  assert.equal(status.canAdvance, true);
});

test('reconciliation blocker stops before calculation and retains detail', () => {
  const status = deriveProcessStatus(base({ reconciliationBlockers: [{ code: 'CC_GROUP_NOT_RECONCILED', message: 'CC_ADUM differs by Rp1.' }] }));
  assert.equal(status.overallStatus, 'BLOCKED');
  assert.equal(status.currentStage, 'RECONCILIATION');
  assert.equal(status.stages.find((stage) => stage.key === 'CALCULATION')?.status, 'WAITING');
  assert.equal(status.stages[2].blockers?.[0].message, 'CC_ADUM differs by Rp1.');
});

test('unresolved mapping blocks reconciliation', () => {
  const status = deriveProcessStatus(base({ reconciliationBlockers: [{ code: 'UNMAPPED_COA', message: '62140001 belum memiliki disposition.' }] }));
  assert.equal(status.currentStage, 'RECONCILIATION');
  assert.equal(status.stages[2].errorCode, 'RECONCILIATION_BLOCKED');
});

test('resolved and reconciled upload advances to calculation', () => {
  const status = deriveProcessStatus(base({ reconciliationReady: true }));
  assert.equal(status.currentStage, 'CALCULATION');
  assert.equal(status.canAdvance, true);
});

test('missing audit templates are visible but do not block Engine 1 calculation', () => {
  const status = deriveProcessStatus(base({ reconciliationReady: true, auditReady: false, auditMissing: ['AUDIT_GHOPO', 'AUDIT_DERIV'] }));
  assert.equal(status.currentStage, 'CALCULATION');
  assert.equal(status.canAdvance, true);
  const audit = status.stages.find((stage) => stage.key === 'AUDIT_READINESS');
  assert.equal(audit?.status, 'NOT_APPLICABLE');
  assert.match(audit?.message ?? '', /AUDIT_GHOPO, AUDIT_DERIV/);
  assert.match(audit?.message ?? '', /tidak memblokir Engine 1/);
});

test('persisted successful run bypasses missing audit templates and advances to post-check', () => {
  const status = deriveProcessStatus(base({
    periodStatus: 'CALCULATED',
    reconciliationReady: true,
    auditReady: false,
    auditMissing: ['AUDIT_GHOPO', 'AUDIT_DERIV', 'AUDIT_SI2000_DRV'],
    calculation: { status: 'SUCCESS', belongsToUpload: true },
  }));
  assert.equal(status.currentStage, 'POST_CHECK');
  assert.equal(status.canAdvance, true);
  assert.equal(status.stages.find((stage) => stage.key === 'CALCULATION')?.status, 'COMPLETED');
});

test('successful calculation and post-check are ready for explicit finalization', () => {
  const status = deriveProcessStatus(base({ periodStatus: 'COST_STRUCTURE_RECONCILED', reconciliationReady: true, calculation: { status: 'SUCCESS', belongsToUpload: true } }));
  assert.equal(status.overallStatus, 'READY');
  assert.equal(status.readyForFinalization, true);
});

test('successful calculation remains ready for finalization even when audit templates are absent', () => {
  const status = deriveProcessStatus(base({
    periodStatus: 'COST_STRUCTURE_RECONCILED',
    reconciliationReady: true,
    auditReady: false,
    auditMissing: ['AUDIT_GHOPO'],
    calculation: { status: 'SUCCESS', belongsToUpload: true },
  }));
  assert.equal(status.overallStatus, 'READY');
  assert.equal(status.readyForFinalization, true);
  assert.equal(status.stages.find((stage) => stage.key === 'AUDIT_READINESS')?.status, 'NOT_APPLICABLE');
});

test('pipeline action contract never includes finalize', async () => {
  const before = deriveProcessStatus(base({ reconciliationReady: true }));
  const calls: string[] = [];
  await executeNextProcessStage(before, { CALCULATION: async () => { calls.push('calculate'); } }, async () => before);
  assert.deepEqual(calls, ['calculate']);
  assert.equal('FINALIZE' in ({ CALCULATION: true, POST_CHECK: true }), false);
});

test('FINALIZED period is read-only', async () => {
  const status = deriveProcessStatus(base({ periodStatus: 'FINALIZED' }));
  let called = false;
  const result = await executeNextProcessStage(status, { POST_CHECK: async () => { called = true; } }, async () => status);
  assert.equal(called, false);
  assert.equal(result.overallStatus, 'FINALIZED');
  assert.equal(result.readyForFinalization, false);
});

test('repeated POST is idempotent once ready', async () => {
  const ready = deriveProcessStatus(base({ reconciliationReady: true, calculation: { status: 'SUCCESS', belongsToUpload: true }, periodStatus: 'COST_STRUCTURE_RECONCILED' }));
  let called = 0;
  await executeNextProcessStage(ready, { POST_CHECK: async () => { called += 1; } }, async () => ready);
  await executeNextProcessStage(ready, { POST_CHECK: async () => { called += 1; } }, async () => ready);
  assert.equal(called, 0);
});

test('reopening status resumes persisted failed calculation stage', () => {
  const status = deriveProcessStatus(base({ reconciliationReady: true, calculation: { status: 'FAILED', belongsToUpload: true, errorMessage: 'HPP input missing.' } }));
  assert.equal(status.currentStage, 'CALCULATION');
  assert.equal(status.canRetry, true);
  assert.equal(status.stages[4].message, 'HPP input missing.');
});

test('Company 2000 optional CC_DRV absence does not block when audit contract is ready', () => {
  const status = deriveProcessStatus(base({ reconciliationReady: true, auditReady: true, auditMissing: [] }));
  assert.equal(status.currentStage, 'CALCULATION');
});

test('Company 7000 missing required Engine-1 source remains a source-validation blocker', () => {
  const status = deriveProcessStatus(base({ uploadStatus: 'VALIDATION_FAILED', validationBlockers: [{ code: 'MISSING_SOURCE', message: 'CC_WHRPG wajib tersedia.' }] }));
  assert.equal(status.currentStage, 'SOURCE_VALIDATION');
  assert.equal(status.stages[1].blockers?.[0].code, 'MISSING_SOURCE');
  assert.equal(status.canAdvance, false);
});

test('post-check errors retain stage-specific details', () => {
  const status = deriveProcessStatus(base({ reconciliationReady: true, periodStatus: 'CALCULATED', calculation: { status: 'SUCCESS', belongsToUpload: true }, postCheckBlockers: [{ code: 'HPP_RECONCILIATION', message: 'HPP difference 1.00.' }] }));
  assert.equal(status.currentStage, 'POST_CHECK');
  assert.equal(status.stages[5].errorCode, 'POST_CHECK_FAILED');
  assert.deepEqual(status.stages[5].blockers, [{ code: 'HPP_RECONCILIATION', message: 'HPP difference 1.00.' }]);
});

test('automatic pipeline leaves audit hydration outside Engine 1 and lets Phase D resolve missing-COA control rows', () => {
  const service = readFileSync('lib/cost-structure/processing/service.ts', 'utf8');
  const hydration = readFileSync('lib/cost-structure/audit-hydration/service.ts', 'utf8');
  assert.doesNotMatch(service, /hydrateAuditSnapshot/);
  assert.match(service, /getAuditSnapshotReadiness/);
  assert.match(hydration, /expectedUploadId\?: number/);
  assert.match(service, /phaseDResolvableIssueCodes[\s\S]*SOURCE_ROW_MISSING_COA/);
  const producedSet = service.match(/const phaseDProducedIssueCodes = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.doesNotMatch(producedSet, /SOURCE_ROW_MISSING_COA/);
});

test('automatic calculation is serialized and skips an existing SUCCESS run for the same upload', () => {
  const service = readFileSync('lib/cost-structure/processing/service.ts', 'utf8');
  const automatic = readFileSync('lib/cost-structure/processing/automatic-calculation.ts', 'utf8');
  const manualRoute = readFileSync('app/api/cost-structure/periods/[id]/calculate/route.ts', 'utf8');

  assert.match(service, /runAutomaticCostStructureCalculation\(periodId, uploadId, userId\)/);
  assert.match(service, /deps\.calculate\(before\.periodId, uploadId, userId\)/);
  assert.match(automatic, /pg_advisory_xact_lock/);
  assert.match(automatic, /activeRun\?\.status === 'SUCCESS'/);
  assert.match(automatic, /activeRun\.uploadId === uploadId/);
  assert.match(automatic, /activeRun\.ruleSetVersion === currentRuleSetVersion/);
  assert.match(automatic, /!predatesReopen/);
  assert.match(automatic, /upload\.periodId !== periodId \|\| !upload\.isActiveVersion/);
  assert.match(manualRoute, /runCostStructureCalculation\(id, auth\.user\.uid\)/);
  assert.doesNotMatch(manualRoute, /runAutomaticCostStructureCalculation/);
});
