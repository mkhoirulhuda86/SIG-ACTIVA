import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateAccounts,
  buildPareto,
  percentOf,
  previousMonth,
  previousYear,
  selectBestSnapshot,
  snapshotReasonMatches,
  ytdPeriods,
} from './dashboard-resume';

test('period comparisons support ordinary months, January rollover, YoY, and YTD', () => {
  assert.equal(previousMonth('2026.08'), '2026.07');
  assert.equal(previousMonth('2026.01'), '2025.12');
  assert.equal(previousYear('2026.08'), '2025.08');
  assert.deepEqual(ytdPeriods('2026.03'), ['2026.01', '2026.02', '2026.03']);
});

test('account 71510001 normalized Aug 2026 MoM reconciles', () => {
  const previous = 25_861_238_435;
  const current = 25_664_884_268;
  assert.equal(current - previous, -196_354_167);
});

test('quality-aware selection prefers valid snapshot 130 over degraded/empty latest imports', () => {
  const candidates = [
    { id: 130, fileName: 'valid.xlsx', createdAt: new Date('2026-08-01'), rekap: {}, currentPeriod: '2026.08', score: 28_500 },
    { id: 131, fileName: 'degraded.xlsx', createdAt: new Date('2026-08-02'), rekap: {}, currentPeriod: '2026.08', score: 28_000 },
    { id: 132, fileName: 'empty.xlsx', createdAt: new Date('2026-08-03'), rekap: {}, currentPeriod: '2026.08', score: -1 },
  ];
  assert.equal(selectBestSnapshot(candidates, '2026.08')?.id, 130);
});

test('classification aggregation excludes parent accounts and reconciles Aug 2026 production totals', () => {
  const accounts = ['71510001', '71510002'];
  const values = new Map([
    ['71510001|2026.08', 25_664_884_268],
    ['71510002|2026.08', 4_312_704_349],
    ['71510000|2026.08', 29_977_588_617],
  ]);
  assert.equal(aggregateAccounts(values, accounts, ['2026.08']), 29_977_588_617);

  const expected = new Map([
    ['beban', 29_977_588_617],
    ['pendapatan-bunga', -14_468_646_506],
    ['pendapatan-lain', 4_435_278_777],
    ['kurs', 12_070_614_627],
  ]);
  for (const [code, amount] of expected) {
    assert.equal(aggregateAccounts(new Map([[`${code}|2026.08`, amount]]), [code], ['2026.08']), amount);
  }
});

test('YTD Jan-Aug production comparisons reconcile', () => {
  const values = new Map<string, number>();
  const current = [30_000_000_000, 30_000_000_000, 30_000_000_000, 30_000_000_000, 30_000_000_000, 30_000_000_000, 97_974_220_140, 0];
  const prior = [40_000_000_000, 40_000_000_000, 40_000_000_000, 40_000_000_000, 40_000_000_000, 40_000_000_000, 122_121_111_248, 0];
  ytdPeriods('2026.08').forEach((period, index) => values.set(`71510001|${period}`, current[index]));
  ytdPeriods('2026.08', -1).forEach((period, index) => values.set(`71510001|${period}`, prior[index]));
  assert.equal(aggregateAccounts(values, ['71510001'], ytdPeriods('2026.08')), 277_974_220_140);
  assert.equal(aggregateAccounts(values, ['71510001'], ytdPeriods('2026.08', -1)), 362_121_111_248);
});

test('zero denominator uses null/NM semantics without NaN or Infinity', () => {
  assert.equal(percentOf(0, 50), null);
  assert.equal(percentOf(0, 0), 0);
});

test('Pareto uses gross absolute movement and reaches at least 80 percent', () => {
  const ranked = buildPareto([
    { accountCode: 'a', movement: 60 },
    { accountCode: 'b', movement: -30 },
    { accountCode: 'c', movement: 10 },
  ]);
  const selected = ranked.filter((row) => row.paretoSelected);
  assert.deepEqual(selected.map((row) => row.accountCode), ['a', 'b']);
  assert.ok(selected.at(-1)!.paretoCumulative >= 0.8);
});

test('snapshot reason is rejected when its movement does not match normalized movement', () => {
  assert.equal(snapshotReasonMatches(-196_354_167, -196_354_167), true);
  assert.equal(snapshotReasonMatches(0, -196_354_167), false);
});
