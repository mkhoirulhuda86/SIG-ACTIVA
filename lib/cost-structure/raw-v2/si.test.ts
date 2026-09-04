import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateCompany2000Si, type SiMapping, type SiSourceRow } from './si';

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
let id = 0;

const row = (source: string, coaCode: string, amount: Prisma.Decimal.Value): SiSourceRow => ({
  id: ++id,
  logicalSourceCode: source,
  originalSheetName: source,
  sourceRowNumber: id,
  coaCode,
  amount: D(amount),
});

const mapping = (
  sourceLogicalCode: string,
  coaCode: string,
  action: SiMapping['action'] = 'INCLUDE',
  extra: Partial<SiMapping> = {}
): SiMapping => ({
  id: ++id,
  sourceLogicalCode,
  coaCode,
  action,
  groupId: sourceLogicalCode === 'CC_ADUM' ? 1 : 2,
  groupCode: sourceLogicalCode === 'CC_ADUM' ? 'ADUM' : 'PASAR',
  natureId: sourceLogicalCode === 'CC_ADUM' ? 11 : 22,
  natureCode: sourceLogicalCode === 'CC_ADUM' ? 'ADMIN' : 'MARKET',
  natureCalculationType: 'MAPPED',
  groupActive: true,
  natureActive: true,
  validFrom: new Date('2026-01-01Z'),
  validTo: null,
  active: true,
  updatedAt: new Date('2026-01-02Z'),
  ...extra,
});

const date = new Date('2026-08-01Z');

test('Stage E reconstructs Rincian, applies effective mappings and negative DERIV exactly', () => {
  const rows = [
    row('TB', '1', 120),
    row('CC_ADUM', '1', 90),
    row('CC_PASAR', '1', 20),
    row('TB', '2', 50),
    row('CC_PASAR', '2', 50),
    row('CC_DERIV', '2', 10),
  ];
  const result = calculateCompany2000Si({
    rows,
    mappings: [mapping('CC_ADUM', '1'), mapping('CC_PASAR', '1'), mapping('CC_PASAR', '2')],
    effectiveDate: date,
  });
  assert.equal(result.success, true);
  assert.equal(result.adumTotal.toString(), '100');
  assert.equal(result.pasarTotal.toString(), '60');
  assert.equal(result.companyTotal.toString(), '160');
  const delta = result.analyticalRows.find((item) => item.analyticalClass === 'RINCIAN_ADUM_DELTA');
  assert.equal(delta?.rawAmount.toString(), '10');
  assert.equal((delta?.reference as { tbAmount?: string }).tbAmount, '120');
  assert.equal(result.analyticalRows.find((item) => item.analyticalClass === 'DERIV_PASAR_OFFSET')?.mappedAmount.toString(), '-10');
});

test('effective date is inclusive and out-of-window non-zero mapping blocks', () => {
  const rows = [row('TB', '1', 5), row('CC_ADUM', '1', 5)];
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1', 'INCLUDE', { validFrom: date, validTo: date })], effectiveDate: date }).success,
    true
  );
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1', 'INCLUDE', { validFrom: new Date('2026-09-01Z') })], effectiveDate: date }).issues[0].code,
    'UNMAPPED'
  );
});

test('ambiguous, cross-group, inactive, and non-MAPPED Nature targets block', () => {
  const rows = [row('TB', '1', 5), row('CC_ADUM', '1', 5)];
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1'), mapping('CC_ADUM', '1')], effectiveDate: date }).issues[0].code,
    'AMBIGUOUS'
  );
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1', 'INCLUDE', { groupCode: 'PASAR' })], effectiveDate: date }).issues[0].code,
    'INVALIDTARGET'
  );
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1', 'INCLUDE', { natureActive: false })], effectiveDate: date }).issues[0].code,
    'INVALIDTARGET'
  );
  assert.equal(
    calculateCompany2000Si({ rows, mappings: [mapping('CC_ADUM', '1', 'INCLUDE', { natureCalculationType: 'FORMULA' })], effectiveDate: date }).issues[0].code,
    'INVALIDTARGET'
  );
});

test('EXCLUDE is evidence-only, RECLASS targets once, and zero unmapped is non-blocking', () => {
  const rows = [row('TB', '1', 10), row('CC_ADUM', '1', 10), row('TB', '2', 4), row('CC_ADUM', '2', 4), row('CC_ADUM', '0', 0)];
  const result = calculateCompany2000Si({
    rows,
    mappings: [mapping('CC_ADUM', '1', 'EXCLUDE'), mapping('CC_ADUM', '2', 'RECLASS', { natureId: 12, natureCode: 'OTHER' })],
    effectiveDate: date,
  });
  assert.equal(result.success, true);
  assert.equal(result.adumTotal.toString(), '4');
  assert.equal(result.coverageBySource.CC_ADUM.exclude.amount.toString(), '10');
  assert.equal(result.coverageBySource.CC_ADUM.unmapped.count, 0);
});

test('missing TB and non-zero delta without ADUM disposition block', () => {
  let result = calculateCompany2000Si({ rows: [row('CC_ADUM', '1', 2)], mappings: [mapping('CC_ADUM', '1')], effectiveDate: date });
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_TB'));
  result = calculateCompany2000Si({ rows: [row('TB', '1', 3), row('CC_ADUM', '1', 2)], mappings: [], effectiveDate: date });
  assert.ok(result.issues.filter((issue) => issue.code === 'UNMAPPED').length >= 2);
});

test('DERIV always uses PASAR mapping; excluded DERIV does not reduce SI', () => {
  const rows = [row('TB', '1', 20), row('CC_PASAR', '1', 20), row('CC_DERIV', '1', 5)];
  const result = calculateCompany2000Si({
    rows,
    mappings: [mapping('CC_PASAR', '1', 'EXCLUDE'), mapping('CC_ADUM', '1')],
    effectiveDate: date,
  });
  assert.equal(result.success, true);
  assert.equal(result.pasarTotal.toString(), '0');
  assert.equal(result.coverageBySource.CC_DERIV.exclude.amount.toString(), '5');
});

test('DERIV outside PASAR blocks and all arithmetic remains Decimal', () => {
  const result = calculateCompany2000Si({
    rows: [row('CC_DERIV', '9', '0.1')],
    mappings: [mapping('CC_PASAR', '9')],
    effectiveDate: date,
  });
  assert.ok(result.issues.some((issue) => issue.code === 'DERIV_NOT_IN_PASAR'));
  assert.ok(result.companyTotal instanceof Prisma.Decimal);
});
