import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCycleDelta,
  deriveReceiverBaselines,
  indexSourceRows,
  resolveReference,
  runCycleEngine,
  splitDeltaByCycle,
} from '.';
import type {
  CycleCcMaster,
  CycleReferenceConfig,
  CycleSourceRow,
} from '../contracts';

const TARGET = '7203311054';
const REFERENCE = '7203311053';
const FALLBACK = '7203311051';

function row(
  sourceOrder: number,
  cycle: '7FT1GF' | '7VT1GF',
  segmentName: string,
  receiverCc: string,
  portion: number,
  startDate = receiverCc === TARGET ? '2023-01-01' : '2022-06-01',
): CycleSourceRow {
  return { sourceRowNumber: sourceOrder + 10, sourceOrder, cycle, startDate, segmentName, receiverCc, portion };
}

function master(receiverCc: string, displayOrder = 1): CycleCcMaster {
  return {
    receiverCc, receiverDescription: receiverCc, plantCode: '7303', plantName: 'Synthetic Plant',
    processCode: `P-${receiverCc}`, processLabel: `Process ${receiverCc}`, displayOrder, active: true,
  };
}

function config(
  reviewStatus: CycleReferenceConfig['reviewStatus'] = 'VALIDATED',
  preferredReferenceCc: string | undefined = REFERENCE,
  fallbackReferenceCcs: string[] = [],
): CycleReferenceConfig {
  return {
    receiverCc: TARGET, peerGroup: 'SYNTHETIC_FINISH_MILL', preferredReferenceCc,
    fallbackReferenceCcs, confidence: reviewStatus === 'VALIDATED' ? 'Validated' : reviewStatus === 'PROPOSED' ? 'High' : 'Manual',
    reviewStatus, active: true,
  };
}

const goldenRows: CycleSourceRow[] = [
  row(20, '7FT1GF', 'FIX-B', TARGET, 0),
  row(10, '7FT1GF', 'FIX-A', TARGET, 0),
  row(40, '7VT1GF', 'VAR-B', TARGET, 0),
  row(30, '7VT1GF', 'VAR-A', TARGET, 0),
  row(120, '7FT1GF', 'FIX-B', REFERENCE, 0),
  row(110, '7FT1GF', 'FIX-A', REFERENCE, 17.5),
  row(140, '7VT1GF', 'VAR-B', REFERENCE, 8.25),
  row(130, '7VT1GF', 'VAR-A', REFERENCE, 0),
];

test('baseline is OFF only when Fixed and Variable portions are all zero', () => {
  const baselines = deriveReceiverBaselines(goldenRows, [master(TARGET), master(REFERENCE)]);
  assert.equal(baselines.find((item) => item.receiverCc === TARGET)?.baselineStatus, 'OFF');
  assert.equal(baselines.find((item) => item.receiverCc === REFERENCE)?.baselineStatus, 'ON');
});

test('baseline is ON for Fixed non-zero with Variable all-zero', () => {
  const rows = [row(1, '7FT1GF', 'A', REFERENCE, 1), row(2, '7VT1GF', 'B', REFERENCE, 0)];
  assert.equal(deriveReceiverBaselines(rows, [master(REFERENCE)])[0].baselineStatus, 'ON');
});

test('baseline is ON for Fixed all-zero with Variable non-zero', () => {
  const rows = [row(1, '7FT1GF', 'A', REFERENCE, 0), row(2, '7VT1GF', 'B', REFERENCE, 1)];
  assert.equal(deriveReceiverBaselines(rows, [master(REFERENCE)])[0].baselineStatus, 'ON');
});

test('ON to ON and OFF to OFF produce NO_CHANGE and no delta', () => {
  const result = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [
    { receiverCc: REFERENCE, targetStatus: 'ON' },
    { receiverCc: TARGET, targetStatus: 'OFF' },
  ], [config()]);
  assert.deepEqual(result.actions.map((action) => action.action), ['NO_CHANGE', 'NO_CHANGE']);
  assert.deepEqual(result.delta, []);
});

test('ON to OFF zeroes every target row and preserves target skeleton and source order', () => {
  const result = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [
    { receiverCc: REFERENCE, targetStatus: 'OFF' },
  ], []);
  assert.equal(result.generationBlocked, false);
  assert.deepEqual(result.delta.map(({ cycle, startDate, segmentName, receiverCc, portion, sourceOrder }) =>
    ({ cycle, startDate, segmentName, receiverCc, portion, sourceOrder })), [
    { cycle: '7FT1GF', startDate: '2022-06-01', segmentName: 'FIX-A', receiverCc: REFERENCE, portion: 0, sourceOrder: 110 },
    { cycle: '7FT1GF', startDate: '2022-06-01', segmentName: 'FIX-B', receiverCc: REFERENCE, portion: 0, sourceOrder: 120 },
    { cycle: '7VT1GF', startDate: '2022-06-01', segmentName: 'VAR-A', receiverCc: REFERENCE, portion: 0, sourceOrder: 130 },
    { cycle: '7VT1GF', startDate: '2022-06-01', segmentName: 'VAR-B', receiverCc: REFERENCE, portion: 0, sourceOrder: 140 },
  ]);
});

test('golden semantic OFF to ON copies only exact per-cycle segment portions onto target rows', () => {
  const result = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [
    { receiverCc: TARGET, targetStatus: 'ON' },
  ], [config()]);
  assert.equal(result.generationBlocked, false);
  assert.equal(result.actions[0].referenceCc, REFERENCE);
  assert.equal(result.actions[0].referenceSource, 'PREFERRED');
  assert.deepEqual(result.delta, [
    { cycle: '7FT1GF', startDate: '2023-01-01', segmentName: 'FIX-A', receiverCc: TARGET, portion: 17.5, sourceOrder: 10 },
    { cycle: '7FT1GF', startDate: '2023-01-01', segmentName: 'FIX-B', receiverCc: TARGET, portion: 0, sourceOrder: 20 },
    { cycle: '7VT1GF', startDate: '2023-01-01', segmentName: 'VAR-A', receiverCc: TARGET, portion: 0, sourceOrder: 30 },
    { cycle: '7VT1GF', startDate: '2023-01-01', segmentName: 'VAR-B', receiverCc: TARGET, portion: 8.25, sourceOrder: 40 },
  ]);
  assert.deepEqual(splitDeltaByCycle(result.delta), { fixed: result.delta.slice(0, 2), variable: result.delta.slice(2) });
  assert.equal(result.fixedAffectedRowCount, 2);
  assert.equal(result.variableAffectedRowCount, 2);
});

test('reference with an all-zero Variable cycle remains eligible when ON overall', () => {
  const rows = goldenRows.map((item) => item.receiverCc === REFERENCE && item.cycle === '7VT1GF' ? { ...item, portion: 0 } : item);
  const result = runCycleEngine(rows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.equal(result.generationBlocked, false);
  assert.deepEqual(result.delta.filter((item) => item.cycle === '7VT1GF').map((item) => item.portion), [0, 0]);
});

test('absent preferred uses first eligible fallback and emits warning', () => {
  const rows = [...goldenRows, ...goldenRows.filter((item) => item.receiverCc === REFERENCE).map((item) => ({ ...item, receiverCc: FALLBACK, sourceOrder: item.sourceOrder + 100 }))]
    .filter((item) => item.receiverCc !== REFERENCE);
  const result = runCycleEngine(rows, [master(TARGET), master(FALLBACK)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config('VALIDATED', REFERENCE, [FALLBACK])]);
  assert.equal(result.actions[0].referenceCc, FALLBACK);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_FALLBACK_USED' && issue.severity === 'WARNING'));
});

test('inactive preferred uses eligible fallback', () => {
  const inactive = goldenRows.map((item) => item.receiverCc === REFERENCE ? { ...item, portion: 0 } : item);
  const fallbackRows = goldenRows.filter((item) => item.receiverCc === REFERENCE).map((item) => ({ ...item, receiverCc: FALLBACK, sourceOrder: item.sourceOrder + 100 }));
  const result = runCycleEngine([...inactive, ...fallbackRows], [master(TARGET), master(REFERENCE), master(FALLBACK)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config('VALIDATED', REFERENCE, [FALLBACK])]);
  assert.equal(result.actions[0].referenceCc, FALLBACK);
  assert.equal(result.generationBlocked, false);
});

test('no usable reference blocks generation', () => {
  const result = runCycleEngine(goldenRows.filter((item) => item.receiverCc === TARGET), [master(TARGET)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.equal(result.generationBlocked, true);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_NOT_IN_UPLOAD' && issue.severity === 'ERROR'));
});

test('explicit self reference blocks with REFERENCE_SELF', () => {
  const result = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON', selectedReferenceCc: TARGET }], [config()]);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_SELF' && issue.severity === 'ERROR'));
  assert.equal(result.generationBlocked, true);
});

test('missing target segment on reference blocks generation', () => {
  const rows = goldenRows.filter((item) => !(item.receiverCc === REFERENCE && item.segmentName === 'VAR-B'));
  const result = runCycleEngine(rows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_SEGMENT_MISSING' && issue.severity === 'ERROR'));
  assert.deepEqual(result.delta, []);
});

test('preferred with incomplete segment coverage yields to a fully covered fallback', () => {
  const preferredIncomplete = goldenRows.filter((item) => !(item.receiverCc === REFERENCE && item.segmentName === 'VAR-B'));
  const fallbackRows = goldenRows.filter((item) => item.receiverCc === REFERENCE).map((item) => ({ ...item, receiverCc: FALLBACK, sourceOrder: item.sourceOrder + 100 }));
  const result = runCycleEngine([...preferredIncomplete, ...fallbackRows], [master(TARGET), master(REFERENCE), master(FALLBACK)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config('VALIDATED', REFERENCE, [FALLBACK])]);
  assert.equal(result.generationBlocked, false);
  assert.equal(result.actions[0].referenceCc, FALLBACK);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_FALLBACK_USED'));
});

test('extra reference segment warns but does not create a target output row', () => {
  const rows = [...goldenRows, row(150, '7FT1GF', 'REFERENCE-ONLY', REFERENCE, 3)];
  const result = runCycleEngine(rows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.equal(result.generationBlocked, false);
  assert.ok(result.issues.some((issue) => issue.code === 'REFERENCE_EXTRA_SEGMENT' && issue.severity === 'WARNING'));
  assert.equal(result.delta.some((item) => item.segmentName === 'REFERENCE-ONLY'), false);
});

test('duplicate Cycle + Segment + Receiver CC key blocks generation', () => {
  const duplicate = { ...goldenRows[0], sourceRowNumber: 999, sourceOrder: 999 };
  const indexed = indexSourceRows([...goldenRows, duplicate]);
  assert.ok(indexed.issues.some((issue) => issue.code === 'DUPLICATE_TARGET_KEY'));
  const result = runCycleEngine([...goldenRows, duplicate], [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.equal(result.generationBlocked, true);
});

test('PROPOSED mapping stays proposed in warning metadata', () => {
  const result = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config('PROPOSED')]);
  const issue = result.issues.find((item) => item.code === 'REFERENCE_MAPPING_PROPOSED');
  assert.equal(issue?.severity, 'WARNING');
  assert.equal(issue?.metadata?.reviewStatus, 'PROPOSED');
  assert.equal(result.generationBlocked, false);
});

test('MANUAL_REQUIRED blocks automatic TURN_ON but permits valid explicit selection', () => {
  const automatic = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config('MANUAL_REQUIRED', undefined)]);
  assert.equal(automatic.generationBlocked, true);
  const explicit = runCycleEngine(goldenRows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON', selectedReferenceCc: REFERENCE }], [config('MANUAL_REQUIRED', undefined)]);
  assert.equal(explicit.generationBlocked, false);
  assert.equal(explicit.actions[0].referenceSource, 'USER_SELECTED');
});

test('negative portion is a non-blocking warning', () => {
  const rows = goldenRows.map((item) => item.receiverCc === REFERENCE && item.segmentName === 'FIX-A' ? { ...item, portion: -4 } : item);
  const result = runCycleEngine(rows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' }], [config()]);
  assert.ok(result.issues.some((issue) => issue.code === 'NEGATIVE_PORTION' && issue.severity === 'WARNING'));
  assert.equal(result.generationBlocked, false);
  assert.equal(result.delta.find((item) => item.segmentName === 'FIX-A')?.portion, -4);
});

test('repeated engine calls are deeply identical and do not mutate input', () => {
  const snapshot = structuredClone(goldenRows);
  const args = [goldenRows, [master(TARGET), master(REFERENCE)], [{ receiverCc: TARGET, targetStatus: 'ON' as const }], [config()]] as const;
  assert.deepEqual(runCycleEngine(...args), runCycleEngine(...args));
  assert.deepEqual(goldenRows, snapshot);
});

test('public resolver and delta builder remain independently executable', () => {
  const baselines = deriveReceiverBaselines(goldenRows, [master(TARGET), master(REFERENCE)]);
  assert.equal(resolveReference(TARGET, [config()], baselines).referenceCc, REFERENCE);
  const delta = buildCycleDelta(goldenRows, [{
    receiverCc: REFERENCE, baselineStatus: 'ON', targetStatus: 'OFF', action: 'TURN_OFF',
    fixedAffectedRows: 2, variableAffectedRows: 2,
  }]);
  assert.equal(delta.length, 4);
  assert.ok(delta.every((item) => item.portion === 0));
});
