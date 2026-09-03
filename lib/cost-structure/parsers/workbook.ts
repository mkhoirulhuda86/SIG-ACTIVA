import * as XLSX from 'xlsx';
import { parseAmount } from './amount';
import { detectSource, normalizeLabel, sourceDefinitions } from './source-registry';
import type { LogicalSourceCode, ParsedWorkbook, ParsedSourceRow } from './types';

// Prefer authoritative raw SAP columns before helper/formula columns when both are present.
const COA = ['ACCOUNT', 'ACCOUNT CODE', 'G/L ACCOUNT', 'GL ACCOUNT', 'COST ELEMENTS', 'COST ELEMENT', 'COA', 'KODE AKUN', 'AKUN', 'KODE', 'CE'];
const DESC = ['ACCOUNT DESCRIPTION', 'DESCRIPTION', 'G/L ACCOUNT LONG TEXT', 'GL DESCRIPTION', 'NAMA AKUN', 'DESKRIPSI', 'DESCR'];
const AMOUNT = ['AMOUNT', 'ACTUAL', 'ACTUAL AMOUNT', 'ACT COSTS', 'VALUE', 'NILAI', 'BALANCE', 'SALDO', 'ACT AMT'];
const COA_REQUIRED = new Set<LogicalSourceCode>(['TB', 'CC_PROD', 'CC_ADUM', 'CC_PASAR', 'CC_WHRPG']);
const RAW_FALLBACK = new Set<LogicalSourceCode>(['COAL', 'CLINKER_PURCHASE', 'SOLAR_PP_ORDER', 'OA_STAT']);
const AUDIT_ONLY = new Set<LogicalSourceCode>(['AUDIT_SI', 'AUDIT_GHOPO', 'AUDIT_DERIV', 'AUDIT_RINCIAN', 'AUDIT_CC_DRV', 'AUDIT_SI2000_DRV']);
const CONTROL_LABELS = new Set(['TOTAL', 'GRAND TOTAL', 'SUBTOTAL', 'DEBIT', 'OVER/UNDERABSORPTION', 'OVER/UND']);

type SheetMatrix = unknown[][];
type MatchedSheet = { name: string; rows: SheetMatrix };

const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'object' && value) {
    if ('result' in value) return text((value as { result: unknown }).result);
    if ('v' in value) return text((value as { v: unknown }).v);
  }
  return String(value).trim() || null;
};

const indexOf = (row: string[], aliases: string[]) => {
  const normalized = row.map((value) => normalizeLabel(value));
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
};

function isRepeatedSemanticHeader(values: unknown[], coaIndex: number, amountIndex: number) {
  if (coaIndex < 0 || amountIndex < 0) return false;
  const labels = values.map((value) => normalizeLabel(text(value) ?? '')).filter(Boolean);
  // Historical SAP exports can repeat the raw semantic header below helper-only headers.
  // The helper cells can be truncated (`Cost Ele` / `Act. Costs`), so detect the repeated
  // header from the complete row instead of requiring the selected helper cells to match.
  return labels.some((label) => COA.includes(label)) && labels.some((label) => AMOUNT.includes(label));
}

function normalizedControlLabel(value: string | null): string {
  return (value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^\*+\s*/, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function isKnownControlRow(description: string | null): boolean {
  return CONTROL_LABELS.has(normalizedControlLabel(description));
}

function extractCoa(value: unknown, header: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (header === 'COST ELEMENTS' || header === 'COST ELEMENT') {
    const match = raw.match(/^\s*(\d{8})(?:\s|$)/);
    return match?.[1] ?? null;
  }
  return raw;
}

function descriptionFromCostElement(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return raw.replace(/^\s*\d{8}\s*/, '').trim() || raw;
}

function loadWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  // The verified SAP workbook contains many historical external-link cache parts. Excel opens
  // those packages, but ExcelJS can reject them while building its full workbook model. Phase C
  // only needs cell values from known logical sheets, so read the OOXML package directly with
  // SheetJS and never materialize external workbook caches as application worksheets.
  return XLSX.read(bytes, {
    type: 'array',
    cellFormula: true,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    bookVBA: false,
  });
}

function sheetMatrix(workbook: XLSX.WorkBook, sheetName: string): SheetMatrix {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as SheetMatrix;
}

function hasMeaningfulRows(rows: SheetMatrix): boolean {
  return rows.some((row) => row.some((value) => text(value) !== null));
}

function preserveRawRows(sheet: MatchedSheet, code: LogicalSourceCode): ParsedSourceRow[] {
  const rows: ParsedSourceRow[] = [];
  let semanticHeaders: string[] = [];
  let oaRole: 'SUMMARY' | 'DERIVATIVE' | 'TRANSACTION' = 'SUMMARY';
  sheet.rows.forEach((values, index) => {
    if (values.every((value) => text(value) === null)) return;
    const rawDataJson: Record<string, string | null> = Object.fromEntries(values.map((value, columnIndex) => [`COLUMN_${columnIndex + 1}`, text(value)]));
    const labels = values.map((value) => normalizeLabel(text(value) ?? ''));
    if (code === 'OA_STAT') {
      if (labels.some((label) => label === 'DER' || label.includes('DERIVATIF'))) {
        oaRole = 'DERIVATIVE';
        semanticHeaders = [];
      }
      const hasCompany = labels.includes('COMPANY CODE');
      const hasGl = labels.includes('G/L ACCOUNT') || labels.includes('GL ACCOUNT');
      const hasAmount = labels.includes('AMOUNT IN LOCAL CURRENCY');
      // A semantic transaction header always starts a transaction section, even when a DER block
      // appeared earlier in the worksheet. This fixes the verified July-2026 OA_STAT layout.
      if (hasGl && hasAmount) {
        semanticHeaders = labels;
        if (hasCompany) oaRole = 'TRANSACTION';
      }
      const glIndex = semanticHeaders.findIndex((label) => label === 'G/L ACCOUNT' || label === 'GL ACCOUNT');
      const amountIndex = semanticHeaders.indexOf('AMOUNT IN LOCAL CURRENCY');
      const companyIndex = semanticHeaders.indexOf('COMPANY CODE');
      const periodIndex = semanticHeaders.findIndex((label) => label === 'POSTING PERIOD' || label === 'PERIOD');
      if (glIndex >= 0 && amountIndex >= 0 && /^\d{8}$/.test(text(values[glIndex]) ?? '')) {
        rawDataJson.ROLE_GL = text(values[glIndex]);
        rawDataJson.ROLE_AMOUNT = text(values[amountIndex]);
        rawDataJson.ROLE = oaRole;
        rawDataJson.COMPANY_CODE = companyIndex >= 0 ? text(values[companyIndex]) : null;
        rawDataJson.POSTING_PERIOD = periodIndex >= 0 ? text(values[periodIndex]) : null;
      } else {
        const gl = values.findIndex((value) => /^\s*\d{8}(?:\s|$)/.test(text(value) ?? ''));
        if (gl >= 0) {
          const glCode = (text(values[gl]) ?? '').trim().slice(0, 8);
          const candidate = values.slice(gl + 1).map(text).find((value) => value !== null && /^\(?-?[\d,.]+\)?-?$/.test(value));
          if (candidate) {
            rawDataJson.ROLE_GL = glCode;
            rawDataJson.ROLE_AMOUNT = candidate;
            rawDataJson.ROLE = oaRole;
          }
        }
      }
    }
    if (code === 'SOLAR_PP_ORDER') {
      if (labels.includes('MATERIAL') && labels.includes('PLANT')) semanticHeaders = labels;
      semanticHeaders.forEach((header, columnIndex) => { if (header) rawDataJson[header] = text(values[columnIndex]); });
      // The real SAP support sheet names this field `Cost Element`; expose the semantic alias used
      // by the Company-7000 adapter without changing the original raw columns.
      const costElement = rawDataJson['COST ELEMENT TEXT'] ?? rawDataJson['COST ELEMENT'];
      if (costElement) rawDataJson['COST ELEMENT TEXT'] = costElement;
    }
    if (code === 'CLINKER_PURCHASE' && index + 1 >= 63 && index + 1 <= 69 && rawDataJson.COLUMN_6 === null) {
      // The locked workbook rule is Excel SUM(F63:F69): the seven rows must exist, while blank
      // cells inside that range have Excel's numeric-zero semantics.
      rawDataJson.COLUMN_6 = '0';
    }
    rows.push({
      logicalSourceCode: code,
      originalSheetName: sheet.name,
      sourceRowNumber: index + 1,
      coaCodeRaw: null,
      descriptionRaw: null,
      amountRaw: null,
      amount: null,
      sourceGroupRaw: null,
      rawDataJson,
    });
  });
  return rows;
}

export async function parseWorkbook(bytes: Uint8Array, companyCode: string): Promise<ParsedWorkbook> {
  const workbook = loadWorkbook(bytes);
  const rows: ParsedSourceRow[] = [];
  const issues: ParsedWorkbook['issues'] = [];
  const sources: ParsedWorkbook['sources'] = [];
  const matched = new Map<string, MatchedSheet[]>();

  for (const sheetName of workbook.SheetNames) {
    if (normalizeLabel(sheetName) === 'META') continue;
    const definition = detectSource(sheetName, companyCode);
    if (!definition) continue;
    const sheet = { name: sheetName, rows: sheetMatrix(workbook, sheetName) };
    matched.set(definition.code, [...(matched.get(definition.code) || []), sheet]);
  }

  for (const definition of sourceDefinitions(companyCode)) {
    const sheets = matched.get(definition.code) || [];
    if (!sheets.length && definition.required) {
      issues.push({ issueCode: 'REQUIRED_SOURCE_MISSING', severity: 'ERROR', message: `Sumber wajib ${definition.code} tidak ditemukan.` });
    }
    if (sheets.length > 1) {
      issues.push({ issueCode: 'SOURCE_AMBIGUOUS', severity: 'ERROR', message: `Lebih dari satu worksheet cocok dengan ${definition.code}: ${sheets.map((sheet) => sheet.name).join(', ')}.` });
    }
    if (sheets.length !== 1) continue;

    const sheet = sheets[0];

    if (AUDIT_ONLY.has(definition.code)) {
      const auditRows = preserveRawRows(sheet, definition.code);
      rows.push(...auditRows);
      sources.push({ code: definition.code, sheetName: sheet.name, rowCount: auditRows.length });
      continue;
    }

    if (companyCode === '2000' && definition.code === 'CC_PROD' && !hasMeaningfulRows(sheet.rows)) {
      issues.push({ issueCode: 'SOURCE_EMPTY', severity: 'INFO', message: `Sumber ${definition.code} terdeteksi sebagai worksheet kosong dan tidak berkontribusi pada Company 2000.` });
      sources.push({ code: definition.code, sheetName: sheet.name, rowCount: 0 });
      continue;
    }

    let headerRow = 0;
    let coa = -1;
    let desc = -1;
    let amount = -1;

    for (let rowIndex = 0; rowIndex < Math.min(sheet.rows.length, 30); rowIndex += 1) {
      const values = (sheet.rows[rowIndex] || []).map((value) => text(value) || '');
      const coaIndex = indexOf(values, COA);
      const descIndex = indexOf(values, DESC);
      const amountIndex = indexOf(values, AMOUNT);
      if (amountIndex >= 0 && (coaIndex >= 0 || descIndex >= 0)) {
        headerRow = rowIndex + 1;
        coa = coaIndex;
        desc = descIndex;
        amount = amountIndex;
        break;
      }
    }

    if (!headerRow) {
      if (RAW_FALLBACK.has(definition.code)) {
        const fallbackRows = preserveRawRows(sheet, definition.code);
        rows.push(...fallbackRows);
        // These source types have verified source-specific adapters. Raw preservation is
        // intentional and is no longer presented to users as a parser warning.
        sources.push({ code: definition.code, sheetName: sheet.name, rowCount: fallbackRows.length });
      } else {
        issues.push({
          issueCode: 'SOURCE_HEADER_NOT_FOUND',
          severity: definition.required ? 'ERROR' : 'WARNING',
          message: `Header tabular yang aman tidak ditemukan pada ${sheet.name}.`,
        });
        sources.push({ code: definition.code, sheetName: sheet.name, rowCount: 0 });
      }
      continue;
    }

    const headerValues = sheet.rows[headerRow - 1] || [];
    const headers = headerValues.map((value, index) => text(value) || `COLUMN_${index + 1}`);
    const coaHeader = coa >= 0 ? normalizeLabel(headers[coa] || '') : '';
    let count = 0;

    for (let rowIndex = headerRow; rowIndex < sheet.rows.length; rowIndex += 1) {
      const values = sheet.rows[rowIndex] || [];
      if (values.every((value) => text(value) === null)) continue;
      // Some SAP exports repeat the semantic header immediately below a helper/formula
      // header. It is layout metadata, not an accounting row.
      if (isRepeatedSemanticHeader(values, coa, amount)) continue;

      const coaRaw = coa >= 0 ? extractCoa(values[coa], coaHeader) : null;
      const descriptionRaw = desc >= 0
        ? text(values[desc])
        : (coaHeader === 'COST ELEMENTS' || coaHeader === 'COST ELEMENT')
          ? descriptionFromCostElement(values[coa])
          : null;
      const amountValue = values[amount];
      const amountRaw = text(amountValue);
      const parsedAmount = parseAmount(amountValue);

      // SAP exports can retain helper-formula/cache cells far below the authoritative report.
      // If the authoritative COA, description, and amount fields are all empty, this is layout
      // metadata rather than an accounting row even when another helper column contains zero.
      if (COA_REQUIRED.has(definition.code) && !coaRaw && !descriptionRaw && amountRaw === null) continue;
      if (COA_REQUIRED.has(definition.code) && !coaRaw && !descriptionRaw && parsedAmount === '0') continue;

      const controlRow = !coaRaw && isKnownControlRow(descriptionRaw);
      const rawDataJson = Object.fromEntries(headers.map((header, index) => [header, text(values[index])]));
      rows.push({
        logicalSourceCode: definition.code,
        originalSheetName: sheet.name,
        sourceRowNumber: rowIndex + 1,
        coaCodeRaw: coaRaw,
        descriptionRaw,
        amountRaw,
        amount: parsedAmount,
        sourceGroupRaw: null,
        rawDataJson,
      });
      count += 1;

      // The production Company-7000 CC reports append a Credit section after the
      // authoritative Debit population. Phase D controls use the first Debit only.
      if (companyCode === '7000' && definition.code.startsWith('CC_') && !coaRaw && normalizedControlLabel(descriptionRaw) === 'DEBIT') break;

      // Report totals/subtotals are intentionally COA-less and must remain available for Phase D
      // reconciliation. They are not malformed detail rows.
      if (COA_REQUIRED.has(definition.code) && !coaRaw && !controlRow) {
        issues.push({ issueCode: 'SOURCE_ROW_MISSING_COA', severity: 'ERROR', message: `COA kosong pada ${sheet.name} baris ${rowIndex + 1}.`, rowIndex: rows.length - 1 });
      }
      if (amountRaw !== null && parsedAmount === null) {
        issues.push({ issueCode: 'SOURCE_ROW_INVALID_AMOUNT', severity: 'ERROR', message: `Amount tidak valid pada ${sheet.name} baris ${rowIndex + 1}.`, rowIndex: rows.length - 1 });
      }
    }
    sources.push({ code: definition.code, sheetName: sheet.name, rowCount: count });
  }

  return { rows, issues, sources };
}
