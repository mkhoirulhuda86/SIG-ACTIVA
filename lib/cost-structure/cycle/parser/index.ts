import * as XLSX from 'xlsx';
import {
  FIXED_CYCLE_CODE,
  VARIABLE_CYCLE_CODE,
  type CycleSourceRow,
  type CycleValidationIssue,
} from '../contracts';

export const CYCLE_REQUIRED_HEADERS = ['Cycle', 'Start Date', 'Segment name', 'Receiver CC', 'Portion/Percent'] as const;
export const MAX_CYCLE_WORKBOOK_ROWS = 100_000;

export type ParsedCycleWorkbook = {
  sheetName: string | null;
  rows: CycleSourceRow[];
  issues: CycleValidationIssue[];
  summary: { totalRows: number; fixedRows: number; variableRows: number; uniqueReceiverCcs: number; errorCount: number; warningCount: number };
};

function textIdentifier(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Number.isInteger(value)) return value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
    return String(value).replace(/\.0+$/, '');
  }
  return String(value ?? '').trim().replace(/\.0+$/, '');
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const candidate = new Date(String(value ?? ''));
  return Number.isNaN(candidate.valueOf()) ? null : candidate.toISOString().slice(0, 10);
}

function normalizedHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function locateDataSheet(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    for (let rowIndex = 0; rowIndex < Math.min(values.length, 25); rowIndex++) {
      const headers = values[rowIndex].map(normalizedHeader);
      if (CYCLE_REQUIRED_HEADERS.every(header => headers.includes(normalizedHeader(header)))) {
        return { sheetName, values, headerIndex: rowIndex, headers };
      }
    }
  }
  return null;
}

export function parseCycleWorkbook(bytes: Uint8Array): ParsedCycleWorkbook {
  const issues: CycleValidationIssue[] = [];
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: false, cellHTML: false, cellNF: false, dense: true });
  } catch {
    issues.push({ code: 'WORKBOOK_UNREADABLE', severity: 'ERROR', message: 'Workbook tidak dapat dibaca.' });
    return result(null, [], issues);
  }
  const located = locateDataSheet(workbook);
  if (!located) {
    issues.push({ code: 'MISSING_REQUIRED_COLUMN', severity: 'ERROR', message: `Tidak ada worksheet dengan header wajib: ${CYCLE_REQUIRED_HEADERS.join(', ')}.` });
    return result(null, [], issues);
  }
  const indexes = Object.fromEntries(located.headers.map((header, index) => [header, index]));
  const rows: CycleSourceRow[] = [];
  const keys = new Set<string>();
  for (let index = located.headerIndex + 1; index < located.values.length; index++) {
    const values = located.values[index];
    if (values.every(value => value == null || String(value).trim() === '')) continue;
    const sourceRowNumber = index + 1;
    const cycle = textIdentifier(values[indexes['cycle']]);
    const segmentName = textIdentifier(values[indexes['segment name']]);
    const receiverCc = textIdentifier(values[indexes['receiver cc']]);
    const startDate = dateValue(values[indexes['start date']]);
    const rawPortion = values[indexes['portion/percent']];
    const portion = typeof rawPortion === 'number' ? rawPortion : Number(String(rawPortion ?? '').trim().replace(',', '.'));
    if (cycle !== FIXED_CYCLE_CODE && cycle !== VARIABLE_CYCLE_CODE) {
      issues.push({ code: 'UNEXPECTED_CYCLE', severity: 'ERROR', message: `Cycle ${cycle || '(kosong)'} tidak didukung.`, sourceRowNumber });
      continue;
    }
    if (!startDate || !segmentName || !receiverCc || !Number.isFinite(portion)) {
      issues.push({ code: 'INVALID_PORTION', severity: 'ERROR', message: 'Baris memiliki Start Date, identifier, atau Portion/Percent yang tidak valid.', sourceRowNumber });
      continue;
    }
    const key = `${cycle}\u0000${segmentName}\u0000${receiverCc}`;
    if (keys.has(key)) {
      issues.push({ code: 'DUPLICATE_TARGET_KEY', severity: 'ERROR', message: `Duplikat Cycle + Segment name + Receiver CC (${cycle}, ${segmentName}, ${receiverCc}).`, sourceRowNumber, receiverCc, segmentName });
      continue;
    }
    keys.add(key);
    const raw = Object.fromEntries(located.headers.map((header, column) => [header, values[column] == null ? null : String(values[column])]));
    rows.push({ sourceRowNumber, sourceOrder: rows.length + 1, cycle, startDate, segmentName, receiverCc, portion, raw });
    if (rows.length > MAX_CYCLE_WORKBOOK_ROWS) throw new Error(`Workbook exceeds ${MAX_CYCLE_WORKBOOK_ROWS} data rows`);
  }
  if (!rows.some(row => row.cycle === FIXED_CYCLE_CODE)) issues.push({ code: 'MISSING_FIXED_CYCLE', severity: 'ERROR', message: 'Cycle Fixed Cost 7FT1GF tidak ditemukan.' });
  if (!rows.some(row => row.cycle === VARIABLE_CYCLE_CODE)) issues.push({ code: 'MISSING_VARIABLE_CYCLE', severity: 'ERROR', message: 'Cycle Variable Cost 7VT1GF tidak ditemukan.' });
  return result(located.sheetName, rows, issues);
}

export function validateCycleReceivers(parsed: ParsedCycleWorkbook, activeReceiverCcs: ReadonlySet<string>): ParsedCycleWorkbook {
  const unknown = new Map<string, number>();
  for (const row of parsed.rows) if (!activeReceiverCcs.has(row.receiverCc) && !unknown.has(row.receiverCc)) unknown.set(row.receiverCc, row.sourceRowNumber);
  const issues = [...parsed.issues, ...[...unknown].map(([receiverCc, sourceRowNumber]): CycleValidationIssue => ({
    code: 'UNMAPPED_RECEIVER_CC', severity: 'ERROR', message: `Receiver CC ${receiverCc} tidak ada pada master Cycle aktif.`, receiverCc, sourceRowNumber,
  }))];
  return result(parsed.sheetName, parsed.rows, issues);
}

function result(sheetName: string | null, rows: CycleSourceRow[], issues: CycleValidationIssue[]): ParsedCycleWorkbook {
  return { sheetName, rows, issues, summary: {
    totalRows: rows.length,
    fixedRows: rows.filter(row => row.cycle === FIXED_CYCLE_CODE).length,
    variableRows: rows.filter(row => row.cycle === VARIABLE_CYCLE_CODE).length,
    uniqueReceiverCcs: new Set(rows.map(row => row.receiverCc)).size,
    errorCount: issues.filter(issue => issue.severity === 'ERROR').length,
    warningCount: issues.filter(issue => issue.severity === 'WARNING').length,
  } };
}
