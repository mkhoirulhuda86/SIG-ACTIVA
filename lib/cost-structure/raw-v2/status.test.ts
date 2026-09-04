import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_V2_RULE_SETS, RAW_V2_WORKFLOW_MODELS } from './constants';
import { getRawV2Status } from './status';

test('Raw V2 has distinct persisted ruleset lineage', () => {
  assert.notEqual(RAW_V2_RULE_SETS['2000'], 'ENGINE1_2000_V2');
  assert.equal(RAW_V2_RULE_SETS['2000'], 'ENGINE1_2000_RAW_V3');
  assert.equal(RAW_V2_RULE_SETS['7000'], 'ENGINE1_7000_RAW_V3');
  assert.notEqual(RAW_V2_RULE_SETS['2000'], RAW_V2_RULE_SETS['7000']);
});

test('Stage F enables operational export after the protected implementation is wired', () => {
  assert.deepEqual(getRawV2Status(), {
    engine: 'RAW_V2',
    phase: 'F_OPERATIONAL_READINESS',
    uploadEnabled: true,
    calculationEnabled: true,
    exportEnabled: true,
    ruleSets: RAW_V2_RULE_SETS,
  });
});

test('Raw V2 workflow boundary uses only dedicated persistence models', () => {
  const names = RAW_V2_WORKFLOW_MODELS.join(' ');
  assert.doesNotMatch(names, /(?:^|\s)CostUpload(?:\s|$)/);
  assert.doesNotMatch(names, /(?:^|\s)CostCalculationRun(?:\s|$)/);
  assert.doesNotMatch(names, /activeCalculationRunId/);
  assert.ok(RAW_V2_WORKFLOW_MODELS.every((name) => name.startsWith('CostRawV2')));
});
