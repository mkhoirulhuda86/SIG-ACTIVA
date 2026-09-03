import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { assertFinalizationReady, assertReconciliationReady, mappingCompleteForReadiness, type FinalizationSnapshot } from './policy';

const control = (resultCode: string, difference = '0.00', status = 'RECONCILED') => ({ resultCode, resultType: 'CONTROL', reconciliationStatus: status, reconciliationDifference: new Prisma.Decimal(difference) });
const total = (resultCode: string) => ({ resultCode, resultType: 'TOTAL', reconciliationStatus: null, reconciliationDifference: null });
const fixture = (companyCode = '2000', periodStatus = 'CALCULATED'): FinalizationSnapshot => ({
  companyCode, periodStatus, run: { id: 9, status: 'SUCCESS', isActive: true, uploadIsActiveVersion: true }, unresolvedErrors: 0, sourceReconciled: true, mappingComplete: true,
  results: companyCode === '7000'
    ? [...['HPP_NATURE_RECONCILIATION', 'ADUM_NATURE_RECONCILIATION', 'PASAR_NATURE_RECONCILIATION'].map((code) => control(code)), ...['TOTAL_HPP', 'TOTAL_ADUM', 'TOTAL_PASAR', 'TOTAL_COMPANY'].map(total)]
    : [control('ADUM_NATURE_RECONCILIATION'), control('PASAR_NATURE_RECONCILIATION'), ...['TOTAL_ADUM', 'TOTAL_PASAR', 'TOTAL_COMPANY'].map(total)],
});

test('CALCULATED with persisted zero controls is reconciliation-ready', () => assert.equal(assertReconciliationReady(fixture()), 9));
test('COST_STRUCTURE_RECONCILED revalidates the same persisted conditions before finalization', () => assert.equal(assertFinalizationReady(fixture('2000', 'COST_STRUCTURE_RECONCILED')), 9));
test('Company 7000 required totals and controls are accepted', () => assert.equal(assertReconciliationReady(fixture('7000')), 9));
test('absolute Rp1 persisted control is accepted even with legacy NOT_RECONCILED status', () => { const value = fixture(); value.results[0] = control('ADUM_NATURE_RECONCILIATION', '-1.00', 'NOT_RECONCILED'); assert.equal(assertReconciliationReady(value), 9); });
test('persisted control above Rp1 blocks even if status says RECONCILED', () => { const value = fixture(); value.results[0] = control('ADUM_NATURE_RECONCILIATION', '1.01', 'RECONCILED'); assert.throws(() => assertReconciliationReady(value), /ADUM_NATURE_RECONCILIATION/); });
test('missing Company 2000 total blocks', () => { const value = fixture(); value.results = value.results.filter((item) => item.resultCode !== 'TOTAL_PASAR'); assert.throws(() => assertReconciliationReady(value), /TOTAL_PASAR/); });
test('missing Company 2000 control blocks', () => { const value = fixture(); value.results = value.results.filter((item) => item.resultCode !== 'PASAR_NATURE_RECONCILIATION'); assert.throws(() => assertReconciliationReady(value), /PASAR_NATURE/); });
test('missing Company 7000 control blocks', () => { const value = fixture('7000'); value.results = value.results.filter((item) => item.resultCode !== 'HPP_NATURE_RECONCILIATION'); assert.throws(() => assertReconciliationReady(value), /HPP_NATURE/); });
test('failed or inactive run blocks both reconcile and finalize', () => { const failed = fixture(); failed.run!.status = 'FAILED'; assert.throws(() => assertReconciliationReady(failed), /SUCCESS/); const inactive = fixture('7000', 'COST_STRUCTURE_RECONCILED'); inactive.run!.isActive = false; assert.throws(() => assertFinalizationReady(inactive), /tidak aktif/); });
test('stale upload version blocks reconcile and finalize', () => { const stale = fixture(); stale.run!.uploadIsActiveVersion = false; assert.throws(() => assertReconciliationReady(stale), /upload versi lama/); const staleFinal = fixture('7000', 'COST_STRUCTURE_RECONCILED'); staleFinal.run!.uploadIsActiveVersion = false; assert.throws(() => assertFinalizationReady(staleFinal), /upload versi lama/); });
test('unresolved validation error blocks', () => { const value = fixture(); value.unresolvedErrors = 1; assert.throws(() => assertReconciliationReady(value), /validation ERROR/); });
test('source reconciliation and mapping completeness block independently', () => { const source = fixture(); source.sourceReconciled = false; assert.throws(() => assertReconciliationReady(source), /Source reconciliation/); const mapping = fixture(); mapping.mappingComplete = false; assert.throws(() => assertReconciliationReady(mapping), /Mapping completeness/); });
test('finalized period is immutable', () => { const value = fixture(); value.periodStatus = 'FINALIZED'; assert.throws(() => assertReconciliationReady(value), /immutable/); });
test('finalization cannot use a CALCULATED snapshot and reconciliation cannot use a reconciled snapshot', () => { assert.throws(() => assertFinalizationReady(fixture()), /COST_STRUCTURE_RECONCILED/); assert.throws(() => assertReconciliationReady(fixture('2000', 'COST_STRUCTURE_RECONCILED')), /CALCULATED/); });

test('post-check/finalization mapping readiness accepts absolute Rp1 de-minimis rows', () => {
  assert.equal(mappingCompleteForReadiness([
    { logicalSourceCode: 'CC_ADUM', coaCodeRaw: '66250008', amount: '-1.00', mappingStatus: 'UNMAPPED' },
    { logicalSourceCode: 'CC_PASAR', coaCodeRaw: '99999999', amount: '1.00', mappingStatus: 'UNMAPPED' },
  ]), true);
});

test('post-check/finalization aggregates per COA before applying Rp1 threshold', () => {
  assert.equal(mappingCompleteForReadiness([
    { logicalSourceCode: 'CC_ADUM', coaCodeRaw: '099', amount: '0.60', mappingStatus: 'UNMAPPED' },
    { logicalSourceCode: 'CC_ADUM', coaCodeRaw: '099', amount: '0.60', mappingStatus: 'UNMAPPED' },
  ]), false);
  assert.equal(mappingCompleteForReadiness([
    { logicalSourceCode: 'CC_ADUM', coaCodeRaw: '100', amount: '1.01', mappingStatus: 'UNMAPPED' },
  ]), false);
});
