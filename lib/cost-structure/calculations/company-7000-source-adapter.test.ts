import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateCompany7000 } from './company-7000';
import { buildCompany7000Input, deriveCompany7000OaFromRincian, deriveCompany7000TotalHpp, type AdapterMapping, type AdapterSourceRow } from './company-7000-source-adapter';
import type { Company7000NatureTarget } from './types';

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const tbRow = (id: number, coaCode: string, amount: string): AdapterSourceRow => ({ id, uploadId: 1, uploadVersion: 1, logicalSourceCode: 'TB', sourceRowNumber: id, coaId: id, coaCode, description: coaCode === '51300003' ? 'COST OF REVENUE-MORTAR' : 'TB', amount: D(amount), rawData: {} });

test('Company 7000 TB selector derives verified Total HPP without an Excel row dependency', () => {
  const result = deriveCompany7000TotalHpp([tbRow(8, '51100001', '413169722810'), tbRow(99, '51300003', '4571043173'), tbRow(2, '40000001', '123')]);
  assert.equal(result.accountGroup5Total.toFixed(2), '417740765983.00');
  assert.equal(result.cogsMortar.toFixed(2), '4571043173.00');
  assert.equal(result.totalHpp.toFixed(2), '413169722810.00');
  assert.deepEqual(result.mortarRows.map((item) => item.id), [99]);
});

test('Company 7000 TB selector treats pre-Mortar historical periods as zero and still blocks ambiguity', () => {
  const historical = deriveCompany7000TotalHpp([tbRow(1, '51100001', '123')]);
  assert.equal(historical.accountGroup5Total.toFixed(2), '123.00');
  assert.equal(historical.cogsMortar.toFixed(2), '0.00');
  assert.equal(historical.totalHpp.toFixed(2), '123.00');
  assert.deepEqual(historical.mortarRows, []);
  assert.throws(() => deriveCompany7000TotalHpp([tbRow(1, '51300003', '1'), tbRow(2, '51300003', '2')]), /more than one/);
});

const nature = (natureId: number, groupCode: 'HPP' | 'ADUM' | 'PASAR', natureCode: string, calculationType: 'MAPPED' | 'FORMULA' | 'RESIDUAL' = 'MAPPED', ruleCode: string | null = null): Company7000NatureTarget => ({
  costGroupId: groupCode === 'HPP' ? 10 : groupCode === 'ADUM' ? 20 : 30,
  natureId, groupCode, natureCode, calculationType, ruleCode, active: true,
});
const natures: Company7000NatureTarget[] = [
  nature(1, 'HPP', 'H01'), nature(6, 'HPP', 'H06'), nature(7, 'HPP', 'H07'), nature(8, 'HPP', 'H08'), nature(14, 'HPP', 'H14'),
  nature(4, 'HPP', 'H04', 'FORMULA', 'COAL_7000_EXISTING'), nature(5, 'HPP', 'H05', 'FORMULA', 'COAL_INBOUND_7000_EXISTING'),
  nature(16, 'HPP', 'H16', 'RESIDUAL', 'HPP_INVENTORY_DIFF_7000'),
  nature(101, 'ADUM', 'N01'), nature(201, 'PASAR', 'N01'), nature(210, 'PASAR', 'OA', 'FORMULA', 'OA_7000_EXISTING'),
];
let nextId = 1000;
const row = (source: string, coaCode: string | null, amount: string | null, sourceRowNumber: number, rawData: Record<string, unknown> = {}, coaId?: number | null): AdapterSourceRow => ({
  id: nextId++, uploadId: 77, uploadVersion: 1, logicalSourceCode: source, sourceRowNumber,
  coaId: coaId === undefined ? (coaCode && /^\d{8}$/.test(coaCode) ? Number(coaCode) : null) : coaId,
  coaCode, description: coaCode, amount: amount === null ? null : D(amount), rawData,
});
const mappings: AdapterMapping[] = [];
const addMap = (source: string, sourceRow: AdapterSourceRow, natureId: number, action: 'INCLUDE' | 'EXCLUDE' | 'RECLASS' = 'INCLUDE') => {
  const target = natures.find((item) => item.natureId === natureId)!;
  mappings.push({ id: mappings.length + 1, sourceLogicalCode: source, coaId: sourceRow.coaId!, mappingAction: action,
    costGroupId: action === 'EXCLUDE' ? null : target.costGroupId, natureId: action === 'EXCLUDE' ? null : target.natureId,
    groupCode: action === 'EXCLUDE' ? null : target.groupCode, natureCode: action === 'EXCLUDE' ? null : target.natureCode,
    targetActive: true, natureCalculationType: action === 'EXCLUDE' ? null : target.calculationType });
};

function fixture() {
  nextId = 1000; mappings.length = 0;
  const rows: AdapterSourceRow[] = [];
  rows.push(row('TB', '51100001', '1000', 3), row('TB', '51300003', '100', 4));
  const tbFuel = row('TB', '62100001', '500', 5); const tbElec = row('TB', '62200001', '100', 6); const tbLaborA = row('TB', '62300001', '80', 7); const tbLaborB = row('TB', '62300002', '20', 8); const tbSolar = row('TB', '62140001', '10', 9);
  const tb6811 = row('TB', '68110001', '100', 31); const tb681405 = row('TB', '68140005', '20', 32); const tb681406 = row('TB', '68140006', '20', 33); const tb6817 = row('TB', '68170002', '30', 34);
  rows.push(tbFuel, tbElec, tbLaborA, tbLaborB, tbSolar, tb6811, tb681405, tb681406, tb6817);
  addMap('CC_PROD', tbFuel, 6); addMap('CC_PROD', tbElec, 7); addMap('CC_PROD', tbLaborA, 8); addMap('CC_PROD', tbLaborB, 8); addMap('CC_PROD', tbSolar, 6);
  addMap('CC_PROD', tb6811, 1); addMap('CC_PROD', tb681405, 1); addMap('CC_PROD', tb681406, 1); addMap('CC_PROD', tb6817, 1);
  rows.push(row('CC_ADUM', '61000001', '0', 10, {}, null));
  const pasar6811 = row('CC_PASAR', '68110001', '10', 11); const pasar681405 = row('CC_PASAR', '68140005', '0', 35); const pasar681406 = row('CC_PASAR', '68140006', '0', 36); const pasar6817 = row('CC_PASAR', '68170002', '20', 12);
  rows.push(pasar6811, pasar681405, pasar681406, pasar6817);
  addMap('CC_PASAR', pasar6811, 201, 'EXCLUDE'); addMap('CC_PASAR', pasar681405, 201, 'EXCLUDE'); addMap('CC_PASAR', pasar681406, 201, 'EXCLUDE'); addMap('CC_PASAR', pasar6817, 201, 'EXCLUDE');
  const whFuel = row('CC_WHRPG', '62110001', '10', 13); const whLabor = row('CC_WHRPG', '62310001', '30', 14); const whInternal = row('CC_WHRPG', '97110001', '5', 15); rows.push(whFuel, whLabor, whInternal); addMap('CC_WHRPG', whFuel, 6); addMap('CC_WHRPG', whLabor, 8); addMap('CC_WHRPG', whInternal, 8, 'EXCLUDE');
  rows.push(row('COAL', null, null, 10, { COLUMN_8: '100.111', COLUMN_9: '30.111' }, null), row('COAL', null, null, 18, { COLUMN_8: '0', COLUMN_9: '0' }, null));
  rows.push(
    row('OA_STAT', null, null, 20, { ROLE_GL: '68110001', ROLE: 'SUMMARY', ROLE_AMOUNT: '1' }, null),
    row('OA_STAT', null, null, 21, { ROLE_GL: '68140005', ROLE: 'SUMMARY', ROLE_AMOUNT: '2' }, null),
    row('OA_STAT', null, null, 22, { ROLE_GL: '68140005', ROLE: 'TRANSACTION', ROLE_AMOUNT: '3', COMPANY_CODE: '7000', POSTING_PERIOD: '8' }, null),
    row('OA_STAT', null, null, 23, { ROLE_GL: '68140006', ROLE: 'SUMMARY', ROLE_AMOUNT: '4' }, null),
    row('OA_STAT', null, null, 24, { ROLE_GL: '68140006', ROLE: 'TRANSACTION', ROLE_AMOUNT: '5', COMPANY_CODE: '7000', POSTING_PERIOD: '8' }, null),
    row('OA_STAT', null, null, 25, { ROLE_GL: '68140005', ROLE: 'DERIVATIVE', ROLE_AMOUNT: '6' }, null),
  );
  rows.push(row('SOLAR_PP_ORDER', null, null, 30, { MATERIAL: '112-200001', PLANT: '7702', 'COST ELEMENT TEXT': 'Consumption Production CKM3n', 'VALUE IN OBJ CRCY': '7' }, null));
  for (let sourceRowNumber = 63; sourceRowNumber <= 69; sourceRowNumber++) rows.push(row('CLINKER_PURCHASE', null, null, sourceRowNumber, { COLUMN_6: '0' }, null));
  return { companyCode: '7000' as const, fiscalPeriod: 8, rows, mappings, natures };
}

test('adapter applies final OA PASAR allocation to HPP by COA and preserves lineage', () => {
  const input = buildCompany7000Input(fixture());
  const expected = new Map([
    ['68110001', '89.00'],
    ['68140005', '9.00'],
    ['68140006', '11.00'],
    ['68170002', '10.00'],
  ]);
  for (const [coa, amount] of expected) {
    const line = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === coa);
    assert.ok(line, `missing HPP allocation line for ${coa}`);
    assert.equal(line.amount.toFixed(2), amount);
  }
  const line6811 = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === '68110001')!;
  assert.equal(String(line6811.sourceReference?.pasarRaw), '10');
  assert.equal(String(line6811.sourceReference?.pasarFinal), '11');
  assert.equal(String(line6811.sourceReference?.pasarAllocationRuleCode), 'OA_7000_EXISTING');
  const line681405 = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === '68140005')!;
  assert.equal(String(line681405.sourceReference?.pasarFinal), '5');
  assert.equal(String(line681405.sourceReference?.derivativeExcluded), '6');
});

test('adapter applies WHRPG and coal corrections once per Nature and preserves current-period OA lineage', () => {
  const input = buildCompany7000Input(fixture());
  const whLaborLines = input.sourceLines.filter((line) => line.ruleCode === 'WHRPG_RECLASS_7000' && line.natureCode === 'H08');
  assert.equal(whLaborLines.length, 1);
  assert.equal(whLaborLines[0].amount.toFixed(2), '-30.00');
  assert.equal(input.sourceLines.filter((line) => line.ruleCode === 'COAL_ENERGY_SPLIT_7000').length, 1);
  assert.equal(input.sourceLines.find((line) => line.ruleCode === 'COAL_ENERGY_SPLIT_7000')!.amount.toFixed(2), '-130.22');
  assert.ok(input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'CC_PASAR'));
  assert.ok(input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'OA_STAT'));
  assert.equal(input.sourceLines.filter((line) => line.logicalSourceCode === 'CC_ADUM').length, 0, 'zero unmapped source remains non-blocking');
  assert.doesNotThrow(() => calculateCompany7000(input));
});

test('adapter and engine treat historical missing Mortar/OA optional components as explicit zero', () => {
  const value = fixture();
  value.rows = value.rows.filter((item) => {
    if (item.logicalSourceCode === 'TB' && item.coaCode === '51300003') return false;
    if (item.logicalSourceCode !== 'OA_STAT') return true;
    const raw = item.rawData as Record<string, unknown>;
    return !(raw.ROLE_GL === '68140005' && (raw.ROLE === 'TRANSACTION' || raw.ROLE === 'DERIVATIVE'));
  });
  const input = buildCompany7000Input(value);
  const line681405 = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === '68140005')!;
  assert.equal(input.formulaDependencies.cogsMortar.amount.toFixed(2), '0.00');
  assert.deepEqual(input.formulaDependencies.cogsMortar.sourceRowIds, []);
  assert.equal(input.formulaDependencies.cogsMortar.sourceReference?.absentTreatedAsZero, true);
  assert.equal(line681405.amount.toFixed(2), '18.00');
  assert.equal(String(line681405.sourceReference?.pasarFinal), '2');
  assert.equal(String(line681405.sourceReference?.derivativeExcluded), '0');
  assert.equal(Boolean(line681405.sourceReference?.derivativeAbsentTreatedAsZero), true);
  const result = calculateCompany7000(input);
  assert.equal(result.formulaResults.totalHpp.toFixed(2), '1000.00');
});

test('engine does not accept empty dependency lineage unless it is explicitly zero-optional', () => {
  const value = fixture();
  value.rows = value.rows.filter((item) => !(item.logicalSourceCode === 'TB' && item.coaCode === '51300003'));
  const input = buildCompany7000Input(value);
  delete input.formulaDependencies.cogsMortar.sourceReference.absentTreatedAsZero;
  assert.throws(() => calculateCompany7000(input), /COGS Mortar requires source-row lineage/);
});

test('adapter treats absence of current-period OA transactions as zero instead of consuming another period', () => {
  const value = fixture(); value.fiscalPeriod = 7;
  const input = buildCompany7000Input(value);
  const line681405 = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === '68140005')!;
  const line681406 = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === '68140006')!;
  assert.equal(line681405.amount.toFixed(2), '12.00');
  assert.equal(line681406.amount.toFixed(2), '16.00');
  assert.doesNotThrow(() => calculateCompany7000(input));
});

test('adapter still fails closed when required OA summary component is missing', () => {
  const value = fixture();
  value.rows = value.rows.filter((item) => !(item.logicalSourceCode === 'OA_STAT' && (item.rawData as Record<string, unknown>).ROLE_GL === '68140005' && (item.rawData as Record<string, unknown>).ROLE === 'SUMMARY'));
  assert.throws(() => buildCompany7000Input(value), /68140005 SUMMARY source component is missing/);
});


test('Company 7000 authoritative Rincian OA reproduces Jan-Jun regression values and July control exactly', () => {
  const cases = [
    { period: 3, values: ['3716214178', '10094520554', '14452383785', '-61269091'], expected: '28201849426.00' },
    { period: 5, values: ['2482012325', '33284583512', '32027815656', '103007785'], expected: '67897419278.00' },
    { period: 6, values: ['2715416078', '31848948493', '28806721700', '103007785'], expected: '63474094056.00' },
    { period: 7, values: ['1488708636', '36586156368', '33890854236', '103007785'], expected: '72068727025.00' },
  ];
  for (const item of cases) {
    nextId = 9000 + item.period * 100;
    const rows = [
      row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: item.values[0] }, null),
      row('AUDIT_RINCIAN', null, null, 339, { COLUMN_1: '68140005', COLUMN_5: item.values[1] }, null),
      row('AUDIT_RINCIAN', null, null, 340, { COLUMN_1: '68140006', COLUMN_5: item.values[2] }, null),
      row('AUDIT_RINCIAN', null, null, 350, { COLUMN_1: '68170002', COLUMN_5: item.values[3] }, null),
      row('AUDIT_RINCIAN', null, null, 351, { COLUMN_1: '68180001', COLUMN_5: '' }, null),
    ];
    const derived = deriveCompany7000OaFromRincian(rows);
    assert.ok(derived, `period ${item.period} authoritative OA should be detected`);
    assert.equal(derived.components[0].amount.toFixed(2), item.expected, `period ${item.period}`);
    assert.equal(derived.components[0].logicalSourceCode, 'AUDIT_RINCIAN');
    assert.equal(derived.components[0].sourceReference?.authoritativeRange, 'rincian biaya!F315:F395');
  }
});

test('adapter prefers authoritative Rincian OA for formula and HPP allocation while retaining derivative isolation', () => {
  const value = fixture();
  value.rows.push(
    row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: '12' }, null),
    row('AUDIT_RINCIAN', null, null, 339, { COLUMN_1: '68140005', COLUMN_5: '7' }, null),
    row('AUDIT_RINCIAN', null, null, 340, { COLUMN_1: '68140006', COLUMN_5: '8' }, null),
    row('AUDIT_RINCIAN', null, null, 350, { COLUMN_1: '68170002', COLUMN_5: '20' }, null),
  );
  const input = buildCompany7000Input(value);
  assert.deepEqual(input.formulaDependencies.oaComponents.map((item) => item.logicalSourceCode), ['AUDIT_RINCIAN']);
  const result = calculateCompany7000(input);
  assert.equal(result.formulaResults.oa.toFixed(2), '47.00');
  const expected = new Map([['68110001', '88.00'], ['68140005', '7.00'], ['68140006', '12.00'], ['68170002', '10.00']]);
  for (const [coa, amount] of expected) {
    const line = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === coa);
    assert.ok(line, `missing authoritative HPP allocation line ${coa}`);
    assert.equal(line.amount.toFixed(2), amount);
    assert.equal(line.sourceReference?.pasarAllocationSourceLogicalCode, 'AUDIT_RINCIAN');
  }
});

test('authoritative Rincian OA fails closed when a non-zero authoritative row cannot be assigned to an 8-digit COA', () => {
  nextId = 9900;
  const rows = [
    row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: '1' }, null),
    row('AUDIT_RINCIAN', null, null, 316, { COLUMN_1: 'TOTAL', COLUMN_5: '2' }, null),
  ];
  assert.throws(() => deriveCompany7000OaFromRincian(rows), /non-zero amount without an 8-digit COA/);
});
