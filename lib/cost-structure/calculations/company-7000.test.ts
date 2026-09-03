import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateCompany7000, COMPANY_7000_RULES } from './company-7000';
import type { Company7000Input } from './company-7000';
import type { Company7000NatureTarget, ResolvedSourceLine } from './types';

const d = (value: string | number) => new Prisma.Decimal(value);
const names = ['H01','H02','H03','H04','H05','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15','H16'];
const hppValues = ['41963786488','8975125427','26664274904',null,null,'6422129096','69402132632','27590902628','35431263500','30907540908','5898145713','30137567870','15046158800','0','1707619761',null];
const natures: Company7000NatureTarget[] = [
  ...names.map((natureCode, index) => ({ costGroupId: 1, natureId: index + 1, groupCode: 'HPP' as const, natureCode, calculationType: index === 3 || index === 4 ? 'FORMULA' as const : index === 15 ? 'RESIDUAL' as const : 'MAPPED' as const, ruleCode: index === 3 ? COMPANY_7000_RULES.coal : index === 4 ? COMPANY_7000_RULES.coalInbound : index === 15 ? COMPANY_7000_RULES.inventoryDifference : null, active: true })),
  { costGroupId: 2, natureId: 101, groupCode: 'ADUM', natureCode: 'N01', calculationType: 'MAPPED', active: true },
  { costGroupId: 3, natureId: 201, groupCode: 'PASAR', natureCode: 'N01', calculationType: 'MAPPED', active: true },
  { costGroupId: 3, natureId: 210, groupCode: 'PASAR', natureCode: 'OA', calculationType: 'FORMULA', ruleCode: COMPANY_7000_RULES.oa, active: true },
];
let rowId = 0;
const line = (groupCode: 'HPP'|'ADUM'|'PASAR', natureId: number, natureCode: string, amount: string, overrides: Partial<ResolvedSourceLine> = {}): ResolvedSourceLine => ({ sourceRowId: ++rowId, uploadId: 50, uploadVersion: 1, logicalSourceCode: groupCode === 'HPP' ? 'CC_PROD' : groupCode === 'ADUM' ? 'CC_ADUM' : 'CC_PASAR', sourceRowNumber: rowId + 5, coaId: rowId + 500, coaCode: `5${rowId}`, amount: d(amount), disposition: 'MAPPED', mappingId: rowId + 1000, mappingAction: 'INCLUDE', costGroupId: groupCode === 'HPP' ? 1 : groupCode === 'ADUM' ? 2 : 3, groupCode, natureId, natureCode, targetActive: true, natureCalculationType: 'MAPPED', applicableMappingCount: 1, ...overrides });
const dep = (amount: string, logicalSourceCode: string, sourceRowIds: number[]) => ({ amount: d(amount), logicalSourceCode, sourceRowIds, sourceReference: { selector: `${logicalSourceCode}:verified-business-item` } });
function golden(): Company7000Input {
  rowId = 0;
  return {
    natures,
    sourceLines: [
      ...hppValues.flatMap((amount, index) => amount === null ? [] : [line('HPP', index + 1, names[index], amount)]),
      line('ADUM', 101, 'N01', '11667383975'), line('PASAR', 201, 'N01', '9572860045'),
    ],
    formulaDependencies: {
      accountGroup5Total: dep('420000000000', 'TB', [900]), cogsMortar: dep('6830277190', 'TB', [901]),
      coalComponents: [dep('50000000000.111', 'COAL', [910]), dep('43152232023.205', 'COAL', [911])],
      coalInboundComponents: [dep('20000000000.111', 'COAL', [912]), dep('21023853211.573', 'COAL', [913])],
      oaComponents: [dep('72068727025', 'OA_STAT', [920])],
    },
  };
}

test('Company 7000 authoritative July-2026 golden arithmetic uses exact Decimal(20,2)', () => {
  const result = calculateCompany7000(golden());
  assert.equal(result.formulaResults.coal.toFixed(2), '93152232023.32');
  assert.equal(result.formulaResults.coalInbound.toFixed(2), '41023853211.68');
  assert.equal(result.formulaResults.totalHpp.toFixed(2), '413169722810.00');
  assert.equal(result.formulaResults.inventoryDifference.toFixed(2), '-21153010152.00');
  assert.equal(result.groupTotals.HPP.toFixed(2), '413169722810.00');
  assert.equal(result.groupTotals.ADUM.toFixed(2), '11667383975.00');
  assert.equal(result.formulaResults.pasarRegular.toFixed(2), '9572860045.00');
  assert.equal(result.formulaResults.oa.toFixed(2), '72068727025.00');
  assert.equal(result.groupTotals.PASAR.toFixed(2), '81641587070.00');
  assert.equal(result.companyTotal.toFixed(2), '506478693855.00');
  assert.ok(result.controls.every((control) => control.difference.isZero()));
  assert.equal(result.actualLines.find((item) => item.ruleCode === COMPANY_7000_RULES.inventoryDifference)?.coaId, null);
});

test('formula normalization is half-up before residual reconciliation and lineage is retained', () => {
  const result = calculateCompany7000(golden());
  const coal = result.actualLines.find((item) => item.ruleCode === COMPANY_7000_RULES.coal)!;
  assert.equal(coal.finalAmount.toFixed(2), '93152232023.32');
  assert.equal(coal.lineType, 'FORMULA');
  assert.deepEqual((coal.sourceReference.dependencies as Array<{sourceRowIds:number[]}>).flatMap((item) => item.sourceRowIds), [910, 911]);
  assert.equal(result.controls.find((item) => item.resultCode === 'HPP_NATURE_RECONCILIATION')?.difference.toFixed(2), '0.00');
});

test('mapping safety, exclusions, reclassification, de-minimis unmapped and Derivatif isolation', () => {
  const base = golden();
  const expected = calculateCompany7000(base).companyTotal.toFixed(2);
  base.sourceLines.push(line('ADUM', 101, 'N01', '999', { logicalSourceCode: 'DERIVATIF' }), line('ADUM', 101, 'N01', '999', { disposition: 'EXCLUDED', mappingAction: 'EXCLUDE' }), line('ADUM', 101, 'N01', '5', { disposition: 'RECLASSIFIED', mappingAction: 'RECLASS' }), line('ADUM', 101, 'N01', '0', { disposition: 'UNMAPPED', applicableMappingCount: 0 }), line('ADUM', 101, 'N01', '-1', { disposition: 'UNMAPPED', applicableMappingCount: 0 }));
  assert.equal(calculateCompany7000(base).companyTotal.toFixed(2), d(expected).add(5).toFixed(2));
  const unknown = golden(); unknown.sourceLines.push(line('ADUM', 101, 'N01', '1.01', { disposition: 'UNMAPPED', applicableMappingCount: 0 }));
  assert.throws(() => calculateCompany7000(unknown), /no effective mapping/);
  const ambiguous = golden(); ambiguous.sourceLines[0].applicableMappingCount = 2;
  assert.throws(() => calculateCompany7000(ambiguous), /ambiguous/);
});

test('inactive, FORMULA and RESIDUAL direct mapping/adjustment targets are rejected', () => {
  const inactive = golden(); inactive.sourceLines[0].targetActive = false;
  assert.throws(() => calculateCompany7000(inactive), /inactive/);
  for (const natureId of [4, 16]) {
    const mapped = golden(); mapped.sourceLines.push(line('HPP', natureId, `H${String(natureId).padStart(2, '0')}`, '1'));
    assert.throws(() => calculateCompany7000(mapped), /cannot be a direct/);
    const adjusted = golden(); const target = natures.find((item) => item.natureId === natureId)!;
    adjusted.adjustments = [{ adjustmentId: 1, costGroupId: 1, groupCode: 'HPP', natureId, natureCode: target.natureCode, coaId: null, amount: d(1), reason: 'invalid', reference: null, targetActive: true, natureCalculationType: target.calculationType }];
    assert.throws(() => calculateCompany7000(adjusted), /cannot receive/);
  }
});

test('formula dependencies fail closed when source contract or lineage is missing', () => {
  const missingCoal = golden(); missingCoal.formulaDependencies.coalComponents = [];
  assert.throws(() => calculateCompany7000(missingCoal), /exactly two verified COAL components/);
  const wrongSource = golden(); wrongSource.formulaDependencies.oaComponents[0].logicalSourceCode = 'CC_PASAR';
  assert.throws(() => calculateCompany7000(wrongSource), /legacy fallback requires OA_STAT lineage/);
  const missingLineage = golden(); missingLineage.formulaDependencies.cogsMortar.sourceRowIds = [];
  assert.throws(() => calculateCompany7000(missingLineage), /requires source-row lineage/);
});

test('identical Company 7000 reruns are deterministic', () => assert.deepEqual(calculateCompany7000(golden()), calculateCompany7000(golden())));


test('engine accepts authoritative AUDIT_RINCIAN OA lineage and rejects mixed authoritative/legacy OA lineage', () => {
  const authoritative = golden();
  authoritative.formulaDependencies.oaComponents = [dep('72068727025', 'AUDIT_RINCIAN', [930, 931, 932, 933])];
  assert.equal(calculateCompany7000(authoritative).formulaResults.oa.toFixed(2), '72068727025.00');
  const mixed = golden();
  mixed.formulaDependencies.oaComponents = [dep('1', 'AUDIT_RINCIAN', [940]), dep('2', 'OA_STAT', [941])];
  assert.throws(() => calculateCompany7000(mixed), /must not be mixed/);
});
