import assert from 'node:assert/strict';
import { test } from 'node:test';

import ExcelJS from 'exceljs';

import {
  CYCLE_OUTPUT_HEADERS,
  CYCLE_OUTPUT_SHEET_NAME,
  FIXED_CYCLE_CODE,
  VARIABLE_CYCLE_CODE,
  type CycleDeltaRow,
} from '../contracts';
import {
  CycleWorkbookMismatchError,
  compareCycleWorkbookBuffers,
  compareCycleWorkbookSemantics,
  formatCycleOutputFilename,
  generateCycleWorkbooks,
  readCycleWorkbookSemantics,
  writeFixedCycleWorkbook,
} from './index';

const fixedRows: CycleDeltaRow[] = [
  {
    cycle: FIXED_CYCLE_CODE,
    startDate: '2026-08-01',
    segmentName: '12345678901234567890',
    receiverCc: '7203311054',
    portion: 0,
    sourceOrder: 8,
  },
  {
    cycle: FIXED_CYCLE_CODE,
    startDate: '2026-08-02',
    segmentName: 'SEG-SECOND',
    receiverCc: '7203311054',
    portion: 2.5,
    sourceOrder: 2,
  },
];

const variableRows: CycleDeltaRow[] = [
  {
    cycle: VARIABLE_CYCLE_CODE,
    startDate: '2026-08-03',
    segmentName: '000012340000',
    receiverCc: '7203311054',
    portion: 6.5,
    sourceOrder: 1,
  },
];

test('fixed-only, variable-only, combined, and empty inputs generate only applicable files', async () => {
  const fixed = await generateCycleWorkbooks(fixedRows, { fiscalYear: 2026, fiscalPeriod: 8 });
  assert.deepEqual(fixed.map(({ cycle, fileName, rowCount }) => ({ cycle, fileName, rowCount })), [
    { cycle: FIXED_CYCLE_CODE, fileName: 'Fix Cost Agt 26.xlsx', rowCount: 2 },
  ]);

  const variable = await generateCycleWorkbooks({ variable: variableRows }, { fiscalYear: 2026, fiscalPeriod: 8 });
  assert.deepEqual(variable.map((file) => file.fileName), ['Var Cost Agt 26.xlsx']);

  const both = await generateCycleWorkbooks([...variableRows, ...fixedRows], {
    fiscalYear: 2026,
    fiscalPeriod: 8,
  });
  assert.deepEqual(both.map((file) => file.fileName), ['Fix Cost Agt 26.xlsx', 'Var Cost Agt 26.xlsx']);
  assert.deepEqual(await generateCycleWorkbooks([], { fiscalYear: 2026, fiscalPeriod: 8 }), []);
});

test('filename formatter uses locked Indonesian abbreviations and two-digit years', () => {
  assert.equal(formatCycleOutputFilename(FIXED_CYCLE_CODE, 2026, 1), 'Fix Cost Jan 26.xlsx');
  assert.equal(formatCycleOutputFilename(FIXED_CYCLE_CODE, 2026, 5), 'Fix Cost Mei 26.xlsx');
  assert.equal(formatCycleOutputFilename(FIXED_CYCLE_CODE, 2026, 8), 'Fix Cost Agt 26.xlsx');
  assert.equal(formatCycleOutputFilename(VARIABLE_CYCLE_CODE, 2026, 10), 'Var Cost Okt 26.xlsx');
  assert.equal(formatCycleOutputFilename(VARIABLE_CYCLE_CODE, 2031, 12), 'Var Cost Des 31.xlsx');
});

test('workbook roundtrip preserves exact contract, values, types, and incoming order', async () => {
  const semantic = await readCycleWorkbookSemantics(await writeFixedCycleWorkbook(fixedRows));
  assert.equal(semantic.worksheetName, CYCLE_OUTPUT_SHEET_NAME);
  assert.deepEqual(semantic.headers, [...CYCLE_OUTPUT_HEADERS]);
  assert.equal(semantic.headers.length, 5);
  assert.deepEqual(semantic.rows, [
    {
      cycle: FIXED_CYCLE_CODE,
      startDate: '2026-08-01',
      segmentName: '12345678901234567890',
      receiverCc: '7203311054',
      portion: 0,
    },
    {
      cycle: FIXED_CYCLE_CODE,
      startDate: '2026-08-02',
      segmentName: 'SEG-SECOND',
      receiverCc: '7203311054',
      portion: 2.5,
    },
  ]);
  assert.equal(typeof semantic.rows[0].portion, 'number');
  assert.equal(typeof semantic.rows[1].portion, 'number');
});

test('variable decimal 6.5 and leading-zero numeric-looking segment survive roundtrip', async () => {
  const [output] = await generateCycleWorkbooks(variableRows, { fiscalYear: 2026, fiscalPeriod: 8 });
  const semantic = await readCycleWorkbookSemantics(output.buffer);
  assert.equal(semantic.rows[0].portion, 6.5);
  assert.equal(semantic.rows[0].segmentName, '000012340000');
});

test('semantic comparator accepts equal and independently regenerated workbooks', async () => {
  const first = await writeFixedCycleWorkbook(fixedRows);
  const second = await writeFixedCycleWorkbook(fixedRows);
  await compareCycleWorkbookBuffers(first, second);
});

test('semantic comparator reports first changed portion', async () => {
  const expected = await readCycleWorkbookSemantics(await writeFixedCycleWorkbook(fixedRows));
  const actual = structuredClone(expected);
  actual.rows[0].portion = 99;
  assert.throws(
    () => compareCycleWorkbookSemantics(expected, actual),
    (error: unknown) => {
      assert.ok(error instanceof CycleWorkbookMismatchError);
      assert.deepEqual(error.details, {
        row: 2,
        column: 'Portion/Percent',
        expected: 0,
        actual: 99,
      });
      return true;
    },
  );
});

test('semantic comparator rejects a missing row', async () => {
  const expected = await readCycleWorkbookSemantics(await writeFixedCycleWorkbook(fixedRows));
  const actual = structuredClone(expected);
  actual.rows.pop();
  assert.throws(() => compareCycleWorkbookSemantics(expected, actual), /row count.*expected 2, actual 1/);
});

test('semantic comparator rejects wrong header order', async () => {
  const expected = await readCycleWorkbookSemantics(await writeFixedCycleWorkbook(fixedRows));
  const actual = structuredClone(expected);
  [actual.headers[0], actual.headers[1]] = [actual.headers[1], actual.headers[0]];
  assert.throws(() => compareCycleWorkbookSemantics(expected, actual), /header 1/);
});

test('semantic comparator rejects wrong worksheet name', async () => {
  const expected = await readCycleWorkbookSemantics(await writeFixedCycleWorkbook(fixedRows));
  const actual = { ...structuredClone(expected), worksheetName: 'Sheet1' };
  assert.throws(() => compareCycleWorkbookSemantics(expected, actual), /worksheet name/);
});

test('reader rejects additional worksheets instead of ignoring contract drift', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Lembar1');
  workbook.addWorksheet('Metadata');
  const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => readCycleWorkbookSemantics(buffer), /exactly one worksheet/);
});

test('writer rejects invalid dates, wrong-cycle rows, and non-finite portions', async () => {
  await assert.rejects(
    () => writeFixedCycleWorkbook([{ ...fixedRows[0], startDate: '2026-02-30' }]),
    /Invalid SAP Start Date/,
  );
  await assert.rejects(() => writeFixedCycleWorkbook(variableRows), /expected 7FT1GF/);
  await assert.rejects(
    () => writeFixedCycleWorkbook([{ ...fixedRows[0], portion: Number.NaN }]),
    /non-finite/,
  );
});
