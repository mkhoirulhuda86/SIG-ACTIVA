import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompany2000HistoricalSupport, applyCompany2000HistoricalSourcePolicy } from './company-2000-source-control-policy';
import type { PersistedSupportRow } from '../calculations/company-2000-si-adapter';
import type { ReconciliationResult } from './types';

const row = (id: number, logicalSourceCode: string, sourceRowNumber: number, rawData: Record<string, unknown>): PersistedSupportRow => ({ id, logicalSourceCode, sourceRowNumber, rawData });

const historicalRows: PersistedSupportRow[] = [
  row(1, 'AUDIT_RINCIAN', 3, { COLUMN_2: 'G/L Acc', COLUMN_5: 'ADM', COLUMN_6: 'Pasar' }),
  row(2, 'AUDIT_RINCIAN', 4, { COLUMN_2: '61110001', COLUMN_5: '86285007530', COLUMN_6: '0' }),
  row(3, 'AUDIT_RINCIAN', 5, { COLUMN_2: '68340003', COLUMN_5: '0', COLUMN_6: '41249013135' }),
  row(4, 'AUDIT_SI', 29, { COLUMN_1: 'Total Adum', COLUMN_2: '86285007.53' }),
  row(5, 'AUDIT_SI', 41, { COLUMN_1: 'Total Perniagaan', COLUMN_2: '41249013.135000005' }),
];

const result = (status: ReconciliationResult['status']): ReconciliationResult => ({
  status,
  detailRowCount: 56,
  controlRowCount: status === 'MISSING_TOTAL' ? 0 : 2,
  detailAmount: '42145314491.00',
  reportedAmount: status === 'MISSING_TOTAL' ? null : '54759053633.00',
  difference: status === 'MISSING_TOTAL' ? null : '-12613739142.00',
  issueCode: status === 'MISSING_TOTAL' ? 'CC_GROUP_TOTAL_NOT_FOUND' : status === 'NOT_RECONCILED' ? 'CC_GROUP_NOT_RECONCILED' : status === 'AMBIGUOUS_TOTAL' ? 'CC_GROUP_TOTAL_AMBIGUOUS' : null,
});

test('production-style RINCIAN and SI totals validate the Company 2000 historical control fallback', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  assert.equal(evidence.readyByGroup.ADUM, true);
  assert.equal(evidence.readyByGroup.PASAR, true);
  assert.equal(evidence.rincianTotals?.PASAR.toString(), '41249013135');
  assert.equal(evidence.siTotals?.PASAR.toString(), '41249013135');
});

test('Company 2000 accepts mismatched or missing Debit only when RINCIAN and SI reconcile', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  for (const status of ['NOT_RECONCILED', 'MISSING_TOTAL'] as const) {
    const policy = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result(status), evidence);
    assert.equal(policy.fallbackUsed, true);
    assert.equal(policy.result.status, 'RECONCILED');
    assert.match(policy.warningMessage ?? '', /RINCIAN\/SI/);
  }
  const ambiguous = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result('AMBIGUOUS_TOTAL'), evidence);
  assert.equal(ambiguous.fallbackUsed, false);
  assert.equal(ambiguous.result.status, 'AMBIGUOUS_TOTAL');
});

test('SI mismatch above Rp1 keeps the source fail-closed', () => {
  const badRows = historicalRows.map((item) => item.id === 5 ? row(5, 'AUDIT_SI', 41, { COLUMN_1: 'Total Perniagaan', COLUMN_2: '41249013.137' }) : item);
  const evidence = evaluateCompany2000HistoricalSupport(badRows);
  assert.equal(evidence.readyByGroup.PASAR, false);
  const policy = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result('NOT_RECONCILED'), evidence);
  assert.equal(policy.fallbackUsed, false);
  assert.equal(policy.result.status, 'NOT_RECONCILED');
});

test('policy never changes Company 7000 source reconciliation', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  const policy = applyCompany2000HistoricalSourcePolicy('7000', 'CC_PASAR', result('NOT_RECONCILED'), evidence);
  assert.equal(policy.fallbackUsed, false);
});
