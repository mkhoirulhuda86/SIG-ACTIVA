/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  evaluateRawV2ExportEligibility,
  REQUIRED_STAGE_E_CONTROL_CODES,
  selectOperationalStageE,
} from './report';
import { buildRawV2ReportWorkbook } from './report-export';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  uploadId: 2,
  status: 'SUCCESS',
  isActive: true,
  ruleSetVersion: 'ENGINE1_2000_RAW_V3',
  sourceSnapshotJson: { stage: 'E_MAPPING_RINCIAN_SI', uploadVersion: 2 },
  ...overrides,
});

const population = () => ({
  ...candidate(),
  controls: REQUIRED_STAGE_E_CONTROL_CODES.map((controlCode) => ({ controlCode, status: 'PASS' })),
  results: [
    { resultCode: 'COMPANY:SI', resultLevel: 'COMPANY' },
    { resultCode: 'GROUP:ADUM', resultLevel: 'COST_GROUP' },
    { resultCode: 'GROUP:PASAR', resultLevel: 'COST_GROUP' },
    { resultCode: 'NATURE:ADUM:N01', resultLevel: 'NATURE' },
  ],
  analyticalRows: [{}],
});

test('operational Stage E selection is active-upload scoped and ignores newer failed, inactive, and superseded runs', () => {
  const selected = selectOperationalStageE([
    candidate({ id: 13, status: 'FAILED' }),
    candidate({ id: 12, isActive: false }),
    candidate({ id: 11, uploadId: 1 }),
    candidate(),
  ], 2);
  assert.equal(selected?.id, 10);
  assert.equal(selectOperationalStageE([candidate({ uploadId: 1 }), candidate({ status: 'FAILED' })], 2), null);
});

test('operational Stage E selection fails closed if active truth is ambiguous', () => {
  assert.equal(selectOperationalStageE([candidate({ id: 10 }), candidate({ id: 11 })], 2), null);
});

test('export eligibility fails closed for missing populations, required controls/results, and failed controls', () => {
  assert.equal(evaluateRawV2ExportEligibility({ companyCode: '2000', activeUploadId: 2, run: population() }).eligible, true);

  const missingControl = population();
  missingControl.controls = missingControl.controls.slice(1);
  const missingResult = population();
  missingResult.results = missingResult.results.filter((row) => row.resultCode !== 'GROUP:PASAR');

  for (const run of [
    null,
    { ...population(), status: 'FAILED' },
    { ...population(), isActive: false },
    { ...population(), controls: population().controls.map((control, index) => index === 0 ? { ...control, status: 'FAIL' } : control) },
    { ...population(), controls: [] },
    missingControl,
    missingResult,
    { ...population(), analyticalRows: [] },
    { ...population(), results: population().results.filter((row) => row.resultLevel !== 'NATURE') },
  ]) {
    assert.equal(evaluateRawV2ExportEligibility({ companyCode: '2000', activeUploadId: 2, run: run as any }).eligible, false);
  }
});

test('export contains persisted report populations, exact evidence, lineage, history, and formula-safe text', async () => {
  const report: any = {
    period: { companyCode: '2000', fiscalYear: 2026, fiscalPeriod: 8, status: 'CALCULATED' },
    upload: { id: 2, version: 2 },
    executive: { finalAdum: '100.25', finalPasar: '20.00', finalCompanySi: '120.25', stageDDifference: '0', rincianAdumCorrection: '0.25', derivRaw: '5', derivContributing: '4', derivExcluded: '1', derivSiOffset: '-4' },
    run: {
      id: 10,
      runNumber: 5,
      status: 'SUCCESS',
      ruleSetVersion: 'ENGINE1_2000_RAW_V3',
      results: [{ id: 1, resultLevel: 'NATURE', costGroupCode: 'ADUM', natureCode: 'N1', natureName: 'People', amount: '100.25' }],
      controls: [{ controlCode: 'CC_ADUM_MAPPING_COMPLETENESS', sourceLogicalCode: 'CC_ADUM', sourceAmount: '100.25', accountedAmount: '100.25', difference: '0', status: 'PASS', metricsJson: { nonZeroCount: 1, include: { count: 1, amount: '100.25' } } }],
      analyticalRows: [{ logicalSourceCode: 'CC_ADUM', originalSheetName: 'ADUM', sourceRowNumber: 7, coaCode: '001', descriptionRaw: '=unsafe', rawAmount: '100.25', mappedAmount: '100.25', analyticalClass: 'BASE_CC_ADUM', mappingStatus: 'INCLUDE', mappingAction: 'INCLUDE', costGroupCode: 'ADUM', natureCode: 'N1', ruleCode: 'RAW_BASE_ADUM', mappingId: 3, mappingEffectiveDate: '2026-08-01', referenceJson: { sourceRowId: 99 } }],
    },
    history: [
      { runNumber: 5, id: 10, stage: 'E_MAPPING_RINCIAN_SI', uploadId: 2, uploadVersion: 2, status: 'SUCCESS', isActive: true, ruleSetVersion: 'ENGINE1_2000_RAW_V3', startedAt: '2026-08-01', completedAt: '2026-08-01', errorMessage: null, resultCount: 1, controlCount: 1, analyticalRowCount: 1 },
      { runNumber: 4, id: 9, stage: 'D_RAW_RECONCILIATION', uploadId: 2, uploadVersion: 2, status: 'FAILED', isActive: false, ruleSetVersion: 'ENGINE1_2000_RAW_V3', startedAt: '2026-08-01', completedAt: '2026-08-01', errorMessage: 'diagnostic', resultCount: 0, controlCount: 0, analyticalRowCount: 0 },
    ],
  };

  const workbook = await buildRawV2ReportWorkbook(report, new Date('2026-09-04T00:00:00Z'));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Nature', 'Mapping Coverage', 'Controls', 'Analytical Lineage', 'Run History']);
  assert.equal(workbook.getWorksheet('Summary')!.getCell('B9').value, 100.25);
  assert.equal(workbook.getWorksheet('Nature')!.getCell('D2').value, 100.25);
  assert.equal(workbook.getWorksheet('Analytical Lineage')!.getCell('E2').value, "'=unsafe");
  assert.match(String(workbook.getWorksheet('Analytical Lineage')!.getCell('R2').value), /sourceRowId/);
  assert.equal(workbook.getWorksheet('Run History')!.rowCount, 3);
});

test('Stage F routes enforce READ and remain isolated from legacy writes', () => {
  const sources = [
    'app/api/cost-structure/raw-v2/report/route.ts',
    'app/api/cost-structure/raw-v2/report/export/route.ts',
    'lib/cost-structure/raw-v2/report-service.ts',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.match(sources, /requireCostStructureRead/);
  assert.doesNotMatch(sources, /\.costPeriod\b|\.costCalculationRun\b|activeCalculationRunId|\.costCalculationResult\b/);
});

test('export fails closed rather than rounding a persisted amount in Excel', async () => {
  const unsafe: any = {
    period: { companyCode: '2000', fiscalYear: 2026, fiscalPeriod: 8, status: 'CALCULATED' },
    upload: { id: 2, version: 2 },
    executive: { finalAdum: '9007199254740993.00' },
    run: { id: 10, runNumber: 5, status: 'SUCCESS', ruleSetVersion: 'ENGINE1_2000_RAW_V3', results: [], controls: [], analyticalRows: [] },
    history: [],
  };
  await assert.rejects(() => buildRawV2ReportWorkbook(unsafe), /cannot be represented safely/);
});
