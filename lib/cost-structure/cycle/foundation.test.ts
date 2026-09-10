import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FIXED_CYCLE_CODE,
  VARIABLE_CYCLE_CODE,
  formatCycleOutputFileName,
  formatCyclePeriodLabel,
} from './contracts';
import {
  costStructureNavigation,
  navigationPathMatches,
  visibleNavigationItems,
} from '../sidebar-navigation';

function csvLines(path: string) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

test('Cycle canonical codes and Indonesian output filename contract remain locked', () => {
  assert.equal(FIXED_CYCLE_CODE, '7FT1GF');
  assert.equal(VARIABLE_CYCLE_CODE, '7VT1GF');
  assert.equal(formatCyclePeriodLabel({ fiscalYear: 2026, fiscalPeriod: 8 }), 'Agt 26');
  assert.equal(formatCycleOutputFileName('FIXED', { fiscalYear: 2026, fiscalPeriod: 8 }), 'Fix Cost Agt 26.xlsx');
  assert.equal(formatCycleOutputFileName('VARIABLE', { fiscalYear: 2026, fiscalPeriod: 9 }), 'Var Cost Sep 26.xlsx');
});

test('Cycle navigation has process/history/admin master without parent-route false activation', () => {
  const cycle = costStructureNavigation.find((item) => item.id === 'cost-cycle');
  assert.ok(cycle);
  assert.deepEqual(
    cycle.children?.map((item) => item.href),
    ['/cost-structure/cycle', '/cost-structure/cycle/history', '/cost-structure/cycle/master'],
  );

  assert.equal(navigationPathMatches('/cost-structure/cycle', '/cost-structure/cycle'), true);
  assert.equal(navigationPathMatches('/cost-structure/cycle', '/cost-structure/cycle/history'), false);
  assert.equal(navigationPathMatches('/cost-structure/cycle/history', '/cost-structure/cycle/history'), true);

  const nonAdmin = visibleNavigationItems(costStructureNavigation, false)
    .find((item) => item.id === 'cost-cycle');
  assert.ok(nonAdmin);
  assert.equal(nonAdmin.children?.some((item) => item.id === 'cost-cycle-master'), false);
});

test('Cycle production CC seed contains 59 unique CC and keeps Plant 7302 process order', () => {
  const lines = csvLines('docs/cost-structure-cycle/CC_MASTER.csv');
  assert.equal(lines.length, 60, 'header + 59 production CC rows expected');

  const rows = lines.slice(1).map((line) => line.split(','));
  const receiverCcs = rows.map((row) => row[2]);
  assert.equal(new Set(receiverCcs).size, 59);

  const tuban1Labels = rows
    .filter((row) => row[0] === '7302')
    .map((row) => row[5]);

  assert.deepEqual(tuban1Labels, [
    'Crusher BK',
    'Crusher TL',
    'Raw Meal',
    'Fine Coal',
    'Fine Coal - New Coal Mill',
    'Kiln',
    'Finish Mill 1',
    'Finish Mill 2',
    'Finish Mill 9',
  ]);
});

test('August reference seed covers 45 CC and preserves validated/manual governance evidence', () => {
  const lines = csvLines('docs/cost-structure-cycle/REFERENCE_MAPPING.csv');
  assert.equal(lines.length, 46, 'header + 45 August Receiver CC reference rows expected');

  assert.equal(
    lines.some((line) => line.startsWith('7203311054,FINISH_MILL_TUBAN_II,7203311053,') && line.includes(',Validated,VALIDATED,')),
    true,
    'FM2 Tuban II -> FM1 Tuban II must remain validated',
  );

  assert.equal(
    lines.some((line) => line.startsWith('7203141081,WHRPG_UNIQUE,,,,Manual,MANUAL_REQUIRED,')),
    true,
    'WHRPG must remain manual-required until a real reference is approved',
  );
});
