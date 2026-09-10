import ExcelJS from 'exceljs';

import {
  CYCLE_OUTPUT_HEADERS,
  CYCLE_OUTPUT_SHEET_NAME,
  FIXED_CYCLE_CODE,
  VARIABLE_CYCLE_CODE,
  formatCycleOutputFileName,
  getCycleKind,
  type CycleCode,
  type CycleDeltaRow,
  type CycleKind,
  type CyclePeriodIdentity,
} from '../contracts';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type GeneratedCycleWorkbook = {
  cycle: CycleCode;
  fileName: string;
  contentType: typeof XLSX_CONTENT_TYPE;
  buffer: Uint8Array;
  rowCount: number;
};

export type SplitCycleDeltaRows = {
  fixed?: readonly CycleDeltaRow[];
  variable?: readonly CycleDeltaRow[];
};

export function formatCycleOutputFilename(
  cycle: CycleCode,
  fiscalYear: number,
  fiscalPeriod: number,
): string {
  return formatCycleOutputFileName(getCycleKind(cycle), { fiscalYear, fiscalPeriod });
}

function parseSapStartDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid SAP Start Date: ${value}`);

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid SAP Start Date: ${value}`);
  }
  return date;
}

function assertRowsForCycle(rows: readonly CycleDeltaRow[], cycle: CycleCode): void {
  rows.forEach((row, index) => {
    if (row.cycle !== cycle) {
      throw new Error(`Delta row ${index + 1} has cycle ${row.cycle}; expected ${cycle}`);
    }
    if (!Number.isFinite(row.portion)) {
      throw new Error(`Delta row ${index + 1} has a non-finite Portion/Percent`);
    }
  });
}

async function writeCycleWorkbook(
  cycle: CycleCode,
  rows: readonly CycleDeltaRow[],
): Promise<Uint8Array> {
  assertRowsForCycle(rows, cycle);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(CYCLE_OUTPUT_SHEET_NAME);
  worksheet.addRow([...CYCLE_OUTPUT_HEADERS]);

  for (const row of rows) {
    const outputRow = worksheet.addRow([
      row.cycle,
      parseSapStartDate(row.startDate),
      row.segmentName,
      row.receiverCc,
      row.portion,
    ]);
    outputRow.getCell(2).numFmt = 'yyyy-mm-dd';
    outputRow.getCell(3).numFmt = '@';
    outputRow.getCell(4).numFmt = '@';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export function writeFixedCycleWorkbook(rows: readonly CycleDeltaRow[]): Promise<Uint8Array> {
  return writeCycleWorkbook(FIXED_CYCLE_CODE, rows);
}

export function writeVariableCycleWorkbook(rows: readonly CycleDeltaRow[]): Promise<Uint8Array> {
  return writeCycleWorkbook(VARIABLE_CYCLE_CODE, rows);
}

function splitRows(input: readonly CycleDeltaRow[] | SplitCycleDeltaRows): Record<CycleKind, CycleDeltaRow[]> {
  if (!Array.isArray(input)) {
    const splitInput = input as SplitCycleDeltaRows;
    return {
      FIXED: [...(splitInput.fixed ?? [])],
      VARIABLE: [...(splitInput.variable ?? [])],
    };
  }

  const split: Record<CycleKind, CycleDeltaRow[]> = { FIXED: [], VARIABLE: [] };
  for (const row of input) split[getCycleKind(row.cycle)].push(row);
  return split;
}

export async function generateCycleWorkbooks(
  input: readonly CycleDeltaRow[] | SplitCycleDeltaRows,
  period: CyclePeriodIdentity,
): Promise<GeneratedCycleWorkbook[]> {
  const rows = splitRows(input);
  const outputs: GeneratedCycleWorkbook[] = [];

  for (const [cycle, kind, writer] of [
    [FIXED_CYCLE_CODE, 'FIXED', writeFixedCycleWorkbook],
    [VARIABLE_CYCLE_CODE, 'VARIABLE', writeVariableCycleWorkbook],
  ] as const) {
    if (rows[kind].length === 0) continue;
    outputs.push({
      cycle,
      fileName: formatCycleOutputFilename(cycle, period.fiscalYear, period.fiscalPeriod),
      contentType: XLSX_CONTENT_TYPE,
      buffer: await writer(rows[kind]),
      rowCount: rows[kind].length,
    });
  }

  return outputs;
}
