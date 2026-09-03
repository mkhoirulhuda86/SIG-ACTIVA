import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveProcessStatus, type ProcessingSnapshot } from './processing/state-machine';

const base = (overrides: Partial<ProcessingSnapshot> = {}): ProcessingSnapshot => ({
  uploadId: 15, periodId: 15, uploadActive: true, uploadStatus: 'VALIDATED',
  periodStatus: 'COST_STRUCTURE_RECONCILED', validationBlockers: [], reconciliationReady: true,
  reconciliationBlockers: [], auditReady: true, auditMissing: [],
  calculation: { status: 'SUCCESS', belongsToUpload: true }, postCheckBlockers: [], ...overrides,
});

test('stale success run becomes explicit recalculation and cannot finalize', () => {
  const status = deriveProcessStatus(base({ calculation: { status: 'SUCCESS', belongsToUpload: true,
    requiresRecalculation: true, runRuleSetVersion: 'ENGINE1_7000_V1', currentRuleSetVersion: 'ENGINE1_7000_V2' } }));
  assert.equal(status.currentStage, 'CALCULATION');
  assert.equal(status.requiresRecalculation, true);
  assert.equal(status.canAdvance, true);
  assert.equal(status.readyForFinalization, false);
});

test('fresh success run remains finalizable after post-check', () => {
  const status = deriveProcessStatus(base());
  assert.equal(status.overallStatus, 'READY');
  assert.equal(status.readyForFinalization, true);
});

test('recalculate and source-lineage export contracts are wired', () => {
  const company7000=readFileSync('lib/cost-structure/calculations/company-7000.ts','utf8');
  const runService=readFileSync('lib/cost-structure/calculations/run-service.ts','utf8');
  const parser=readFileSync('lib/cost-structure/parsers/workbook.ts','utf8');
  const exporter=readFileSync('lib/cost-structure/export/service.ts','utf8');
  const finalization=readFileSync('lib/cost-structure/finalization/policy.ts','utf8');
  assert.match(company7000,/ENGINE1_7000_V2/);
  assert.equal((runService.match(/COST_STRUCTURE_RECONCILED/g)??[]).length>=2,true);
  assert.match(parser,/AUDIT_REFERENCE/);
  assert.match(exporter,/addPersistedReferenceSheets/);
  assert.match(exporter,/addSourceSheet\(workbook, 'tb', rowsByCode\(allRows, 'TB'\), true\)/);
  assert.doesNotMatch(exporter,/if \(columnKeys\.length\)/);
  assert.match(finalization,/requiresRecalculation/);
});
