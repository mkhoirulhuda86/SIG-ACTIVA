import assert from 'node:assert/strict';
import test from 'node:test';
import { runCycleEngine } from '.';
import type { CycleCcMaster, CycleSourceRow } from '../contracts';

const TARGET = '7203311054';

const master: CycleCcMaster = {
  receiverCc: TARGET,
  receiverDescription: 'Finish Mill 2 Tuban II',
  plantCode: '7303',
  plantName: 'PL Plant Tuban II',
  processCode: 'FINISH_MILL',
  processLabel: 'Finish Mill 2',
  displayOrder: 62,
  active: true,
};

const rows: CycleSourceRow[] = [
  { sourceRowNumber: 2, sourceOrder: 1, cycle: '7FT1GF', startDate: '2023-01-01', segmentName: 'FIX-A', receiverCc: TARGET, portion: 1 },
  { sourceRowNumber: 3, sourceOrder: 2, cycle: '7VT1GF', startDate: '2023-01-01', segmentName: 'VAR-A', receiverCc: TARGET, portion: 1 },
];

test('duplicate same-status target request blocks generation and creates no duplicate action', () => {
  const result = runCycleEngine(rows, [master], [
    { receiverCc: TARGET, targetStatus: 'OFF' },
    { receiverCc: TARGET, targetStatus: 'OFF' },
  ], []);
  assert.equal(result.generationBlocked, true);
  assert.deepEqual(result.delta, []);
  assert.equal(result.actions.some((action) => action.receiverCc === TARGET), false);
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_TARGET_REQUEST' && issue.severity === 'ERROR'));
});

test('conflicting target requests for one Receiver CC block generation fail-closed', () => {
  const result = runCycleEngine(rows, [master], [
    { receiverCc: TARGET, targetStatus: 'OFF' },
    { receiverCc: TARGET, targetStatus: 'ON' },
  ], []);
  assert.equal(result.generationBlocked, true);
  assert.deepEqual(result.delta, []);
  assert.equal(result.actions.some((action) => action.receiverCc === TARGET), false);
  const issue = result.issues.find((item) => item.code === 'DUPLICATE_TARGET_REQUEST');
  assert.equal(issue?.metadata?.firstTargetStatus, 'OFF');
  assert.equal(issue?.metadata?.duplicateTargetStatus, 'ON');
});
