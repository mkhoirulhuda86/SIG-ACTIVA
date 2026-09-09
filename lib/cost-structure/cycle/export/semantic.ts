import ExcelJS from 'exceljs';

import { CYCLE_OUTPUT_HEADERS, type CycleCode } from '../contracts';

export type SemanticCycleRow = {
  cycle: string;
  startDate: string;
  segmentName: string;
  receiverCc: string;
  portion: number;
};

export type SemanticCycleWorkbook = {
  worksheetName: string;
  headers: string[];
  rows: SemanticCycleRow[];
};

export class CycleWorkbookMismatchError extends Error {
  constructor(
    message: string,
    readonly details: {
      row?: number;
      column: string;
      expected: unknown;
      actual: unknown;
    },
  ) {
    super(message);
    this.name = 'CycleWorkbookMismatchError';
  }
}

function scalar(value: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if ('result' in value && value.result !== undefined) return scalar(value.result);
  if ('text' in value) return value.text;
  throw new Error('Unsupported complex Excel cell value');
}

function textIdentifier(value: ExcelJS.CellValue, label: string): string {
  const normalized = scalar(value);
  if (typeof normalized !== 'string' && typeof normalized !== 'number') {
    throw new Error(`${label} must be a text or numeric identifier`);
  }
  return String(normalized);
}

function semanticDate(value: ExcelJS.CellValue): string {
  const normalized = scalar(value);
  if (normalized instanceof Date) {
    return [
      normalized.getUTCFullYear(),
      String(normalized.getUTCMonth() + 1).padStart(2, '0'),
      String(normalized.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }
  if (typeof normalized === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(normalized);
    if (match) return match[1];
  }
  throw new Error(`Start Date is not a supported semantic date: ${String(normalized)}`);
}

export async function readCycleWorkbookSemantics(
  input: Uint8Array | ArrayBuffer,
): Promise<SemanticCycleWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as ExcelJS.Buffer);
  if (workbook.worksheets.length !== 1) {
    throw new Error(`Expected exactly one worksheet, found ${workbook.worksheets.length}`);
  }
  const worksheet = workbook.worksheets[0];
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) =>
    textIdentifier(worksheet.getCell(1, index + 1).value, `Header ${index + 1}`),
  );
  const rows: SemanticCycleRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const portion = scalar(row.getCell(5).value);
    if (typeof portion !== 'number' || !Number.isFinite(portion)) {
      throw new Error(`Portion/Percent at row ${rowNumber} is not numeric`);
    }
    rows.push({
      cycle: textIdentifier(row.getCell(1).value, 'Cycle'),
      startDate: semanticDate(row.getCell(2).value),
      segmentName: textIdentifier(row.getCell(3).value, 'Segment name'),
      receiverCc: textIdentifier(row.getCell(4).value, 'Receiver CC'),
      portion,
    });
  }
  return { worksheetName: worksheet.name, headers, rows };
}

function mismatch(
  column: string,
  expected: unknown,
  actual: unknown,
  row?: number,
): never {
  const location = row === undefined ? column : `row ${row}, column ${column}`;
  throw new CycleWorkbookMismatchError(
    `Cycle workbook mismatch at ${location}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`,
    { row, column, expected, actual },
  );
}

export function compareCycleWorkbookSemantics(
  expected: SemanticCycleWorkbook,
  actual: SemanticCycleWorkbook,
): void {
  if (expected.worksheetName !== actual.worksheetName) {
    mismatch('worksheet name', expected.worksheetName, actual.worksheetName);
  }
  if (expected.headers.length !== actual.headers.length) {
    mismatch('header count', expected.headers.length, actual.headers.length);
  }
  expected.headers.forEach((header, index) => {
    if (header !== actual.headers[index]) mismatch(`header ${index + 1}`, header, actual.headers[index]);
  });
  if (expected.rows.length !== actual.rows.length) {
    mismatch('row count', expected.rows.length, actual.rows.length);
  }

  const fields: Array<[keyof SemanticCycleRow, string]> = [
    ['cycle', CYCLE_OUTPUT_HEADERS[0]],
    ['startDate', CYCLE_OUTPUT_HEADERS[1]],
    ['segmentName', CYCLE_OUTPUT_HEADERS[2]],
    ['receiverCc', CYCLE_OUTPUT_HEADERS[3]],
    ['portion', CYCLE_OUTPUT_HEADERS[4]],
  ];
  expected.rows.forEach((expectedRow, index) => {
    for (const [field, column] of fields) {
      if (expectedRow[field] !== actual.rows[index][field]) {
        mismatch(column, expectedRow[field], actual.rows[index][field], index + 2);
      }
    }
  });
}

export async function compareCycleWorkbookBuffers(
  expected: Uint8Array | ArrayBuffer,
  actual: Uint8Array | ArrayBuffer,
): Promise<void> {
  compareCycleWorkbookSemantics(
    await readCycleWorkbookSemantics(expected),
    await readCycleWorkbookSemantics(actual),
  );
}

export function isSupportedCycle(value: string): value is CycleCode {
  return value === '7FT1GF' || value === '7VT1GF';
}
