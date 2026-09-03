import 'server-only';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyWorkbookStyleBlueprint } from './style-blueprint/apply';
import { getWorkbookStyleBlueprint } from './style-blueprint/registry';

type RawRecord = Record<string, unknown>;
type SourceRow = {
  id: number;
  logicalSourceCode: string;
  originalSheetName: string;
  sourceRowNumber: number;
  coaCodeRaw: string | null;
  descriptionRaw: string | null;
  amountRaw: string | null;
  amount: Prisma.Decimal | null;
  rawDataJson: Prisma.JsonValue | null;
};

const AUDIT_TEMPLATE_CODES = new Set(['AUDIT_SI', 'AUDIT_GHOPO', 'AUDIT_DERIV', 'AUDIT_RINCIAN', 'AUDIT_CC_DRV', 'AUDIT_SI2000_DRV']);
const ACCOUNTING_FORMAT = '#,##0.00;[Red](#,##0.00);-';

function record(value: Prisma.JsonValue | null): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : {};
}
function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed) && trimmed.length < 16) return Number(trimmed);
    return value;
  }
  return JSON.stringify(value);
}
function columnIndex(key: string) {
  const match = key.match(/^COLUMN_(\d+)$/i);
  return match ? Number(match[1]) : null;
}
function rowsByCode(rows: SourceRow[], code: string) { return rows.filter((row) => row.logicalSourceCode === code); }
function decimalToDisplay(value: Prisma.Decimal | string | number, divisor = 1) {
  return new Prisma.Decimal(value).div(divisor).toNumber();
}

function applyBasicAuditStyle(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const first = sheet.getRow(1);
  first.font = { bold: true };
  first.alignment = { vertical: 'middle', wrapText: true };
  first.eachCell((cell) => { cell.border = { bottom: { style: 'thin' } }; });
  sheet.autoFilter = sheet.rowCount > 1 && sheet.columnCount > 0 ? { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } } : undefined;
  for (let c = 1; c <= sheet.columnCount; c += 1) sheet.getColumn(c).width = Math.min(40, Math.max(12, sheet.getColumn(c).width ?? 12));
}

/** Writes raw COLUMN_n snapshots at their original row positions, preserving blank-row gaps. */
function writeRawMatrix(sheet: ExcelJS.Worksheet, rows: SourceRow[]) {
  for (const row of rows) {
    const raw = record(row.rawDataJson);
    const indexed = Object.entries(raw)
      .map(([key, value]) => [columnIndex(key), value] as const)
      .filter((entry): entry is readonly [number, unknown] => entry[0] !== null)
      .sort((a, b) => a[0] - b[0]);
    for (const [index, value] of indexed) sheet.getCell(row.sourceRowNumber, index).value = scalar(value);
  }
}

function writeNormalizedSource(sheet: ExcelJS.Worksheet, rows: SourceRow[]) {
  const rawKeys = [...new Set(rows.flatMap((row) => Object.keys(record(row.rawDataJson))))].filter((key) => !key.startsWith('ROLE_') && !['ROLE', 'COMPANY_CODE', 'POSTING_PERIOD'].includes(key));
  const preferred = ['Source Row', 'COA', 'Description', 'Amount'];
  const headers = [...preferred, ...rawKeys];
  sheet.addRow(headers);
  for (const row of rows) {
    const raw = record(row.rawDataJson);
    sheet.addRow([
      row.sourceRowNumber,
      row.coaCodeRaw,
      row.descriptionRaw,
      row.amount?.toString() ?? row.amountRaw,
      ...rawKeys.map((key) => scalar(raw[key])),
    ]);
  }
  applyBasicAuditStyle(sheet);
}

function requireAuditRows(allRows: SourceRow[], code: string, label: string) {
  const rows = rowsByCode(allRows, code);
  if (!rows.length) throw new Error(`Audit snapshot ${label} belum dipersist. Lakukan audit hydration/upload ulang sebelum export.`);
  return rows;
}

function findResult(run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>, code: string) {
  return run.results.find((result) => result.resultCode === code);
}
function findNature(run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>, groupCode: string, natureCode: string) {
  return run.results.find((result) => result.resultCode === 'NATURE_TOTAL' && result.costGroup?.code === groupCode && result.nature?.code === natureCode);
}

async function loadExportRun(periodId: number) {
  const period = await prisma.costPeriod.findUnique({
    where: { id: periodId },
    include: {
      company: true,
      activeCalculationRun: {
        include: {
          upload: { include: { sourceRows: { orderBy: [{ logicalSourceCode: 'asc' }, { sourceRowNumber: 'asc' }] } } },
          results: { include: { costGroup: true, nature: true }, orderBy: { id: 'asc' } },
          actualLines: { include: { costGroup: true, nature: true, coa: true, sourceRow: true }, orderBy: { id: 'asc' } },
        },
      },
    },
  });
  if (!period?.activeCalculationRun || period.activeCalculationRun.status !== 'SUCCESS' || !period.activeCalculationRun.isActive) return null;
  if (!period.activeCalculationRun.upload.isActiveVersion) throw new Error('Active calculation run masih terikat ke upload versi lama. Proses upload aktif terlebih dahulu sebelum export.');
  return { period, ...period.activeCalculationRun };
}

function writeCompany7000Ghopo(workbook: ExcelJS.Workbook, run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>) {
  const rows = requireAuditRows(run.upload.sourceRows as SourceRow[], 'AUDIT_GHOPO', 'GHoPO');
  const sheet = workbook.addWorksheet('GHoPO');
  writeRawMatrix(sheet, rows);
  const hppRows = Array.from({ length: 16 }, (_, index) => [`H${String(index + 1).padStart(2, '0')}`, index + 3] as const);
  const adumRows = Array.from({ length: 9 }, (_, index) => [`N${String(index + 1).padStart(2, '0')}`, index + 23] as const);
  const pasarRows = Array.from({ length: 9 }, (_, index) => [`N${String(index + 1).padStart(2, '0')}`, index + 35] as const);
  for (const [code, row] of hppRows) { const result = findNature(run, 'HPP', code); if (!result) throw new Error(`Persisted HPP ${code} tidak tersedia.`); sheet.getCell(row, 2).value = decimalToDisplay(result.amount, 1000); }
  for (const [code, row] of adumRows) { const result = findNature(run, 'ADUM', code); if (!result) throw new Error(`Persisted ADUM ${code} tidak tersedia.`); sheet.getCell(row, 2).value = decimalToDisplay(result.amount, 1000); }
  for (const [code, row] of pasarRows) { const result = findNature(run, 'PASAR', code); if (!result) throw new Error(`Persisted PASAR ${code} tidak tersedia.`); sheet.getCell(row, 2).value = decimalToDisplay(result.amount, 1000); }
  const totalHpp = findResult(run, 'TOTAL_HPP'); const totalAdum = findResult(run, 'TOTAL_ADUM'); const oa = findNature(run, 'PASAR', 'OA');
  if (!totalHpp || !totalAdum || !oa) throw new Error('Persisted Company 7000 totals/OA tidak lengkap.');
  sheet.getCell(19, 2).value = decimalToDisplay(totalHpp.amount, 1000);
  sheet.getCell(32, 2).value = decimalToDisplay(totalAdum.amount, 1000);
  sheet.getCell(45, 2).value = decimalToDisplay(oa.amount, 1000);
}

function writeZeroDerivSheet(workbook: ExcelJS.Workbook, run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>) {
  const sheet = workbook.addWorksheet('DERIV');
  const sections: Array<{ headerRow: number; header: string; group: string; codes: string[]; startRow: number; totalRow: number }> = [
    { headerRow: 2, header: 'Beban Pokok Penjualan', group: 'HPP', codes: Array.from({ length: 16 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`), startRow: 3, totalRow: 19 },
    { headerRow: 22, header: 'UMUM & ADMINISTRASI', group: 'ADUM', codes: Array.from({ length: 9 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`), startRow: 23, totalRow: 32 },
    { headerRow: 34, header: 'PEMASARAN', group: 'PASAR', codes: Array.from({ length: 9 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`), startRow: 35, totalRow: 44 },
  ];
  for (const section of sections) {
    sheet.getCell(section.headerRow, 1).value = section.header;
    section.codes.forEach((code, index) => {
      const nature = findNature(run, section.group, code);
      sheet.getCell(section.startRow + index, 1).value = nature?.nature?.name ?? code;
      sheet.getCell(section.startRow + index, 2).value = 0;
    });
    sheet.getCell(section.totalRow, 1).value = section.group === 'HPP' ? 'Total HPP' : section.group === 'ADUM' ? 'Total Adum' : 'Total Perniagaan';
    sheet.getCell(section.totalRow, 2).value = 0;
  }
  const oa = findNature(run, 'PASAR', 'OA');
  sheet.getCell(45, 1).value = oa?.nature?.name ?? 'OA';
  sheet.getCell(45, 2).value = 0;
  sheet.getCell(46, 1).value = 'Total Pemasaran';
  sheet.getCell(46, 2).value = 0;
}

function writeCompany2000Si(workbook: ExcelJS.Workbook, run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>) {
  const rows = requireAuditRows(run.upload.sourceRows as SourceRow[], 'AUDIT_SI', 'SI');
  const sheet = workbook.addWorksheet('SI');
  writeRawMatrix(sheet, rows);
  const adumRows = Array.from({ length: 9 }, (_, index) => [`N${String(index + 1).padStart(2, '0')}`, index + 20] as const);
  const pasarRows = Array.from({ length: 9 }, (_, index) => [`N${String(index + 1).padStart(2, '0')}`, index + 32] as const);
  for (const [code, row] of adumRows) { const result = findNature(run, 'ADUM', code); if (result) sheet.getCell(row, 2).value = decimalToDisplay(result.amount, 1000); }
  for (const [code, row] of pasarRows) { const result = findNature(run, 'PASAR', code); if (result) sheet.getCell(row, 2).value = decimalToDisplay(result.amount, 1000); }
  const totalAdum = findResult(run, 'TOTAL_ADUM'); const totalPasar = findResult(run, 'TOTAL_PASAR');
  if (totalAdum) sheet.getCell(29, 2).value = decimalToDisplay(totalAdum.amount, 1000);
  if (totalPasar) sheet.getCell(41, 2).value = decimalToDisplay(totalPasar.amount, 1000);
}

function flattenJson(value: unknown, path = '', output: Array<{ path: string; value: string }> = []) {
  if (value === null || value === undefined) { output.push({ path, value: '' }); return output; }
  if (Array.isArray(value)) { value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, output)); return output; }
  if (typeof value === 'object') { Object.entries(value as Record<string, unknown>).forEach(([key, item]) => flattenJson(item, path ? `${path}.${key}` : key, output)); return output; }
  output.push({ path, value: String(value) }); return output;
}

function writeFormulaAudit(workbook: ExcelJS.Workbook, run: NonNullable<Awaited<ReturnType<typeof loadExportRun>>>) {
  const sheet = workbook.addWorksheet('Formula Audit');
  const metadata: Array<[string, string | number | null]> = [
    ['Company', run.period.company.companyCode], ['Fiscal Year', run.period.fiscalYear], ['Fiscal Period', run.period.fiscalPeriod],
    ['Period Status', run.period.status], ['Upload Version', run.upload.version], ['Source File', run.upload.originalFileName], ['Source SHA-256', run.upload.fileHashSha256],
    ['Calculation Run', run.runNumber], ['Rule Set', run.ruleSetVersion], ['Calculated At', run.completedAt?.toISOString() ?? null], ['Finalized At', run.period.finalizedAt?.toISOString() ?? null],
    ['Export Designation', run.period.status === 'FINALIZED' ? 'OFFICIAL' : 'DRAFT'],
  ];
  metadata.forEach(([label, value]) => sheet.addRow([label, value]));
  sheet.addRow([]);
  sheet.addRow(['Cost Group','Nature Code','Nature','Line Type','COA','Rule Code','Final Amount','Lineage Path','Persisted Value']);
  for (const line of run.actualLines) {
    const flattened = flattenJson(line.sourceReferenceJson ?? {});
    if (!flattened.length) flattened.push({ path: '', value: '' });
    for (const item of flattened) sheet.addRow([line.costGroup.code, line.nature.code, line.nature.name, line.lineType, line.coa?.coaCode ?? null, line.ruleCode, line.finalAmount.toString(), item.path, item.value]);
  }
  for (const result of run.results.filter((item) => item.calculationDetailJson)) {
    for (const item of flattenJson(result.calculationDetailJson)) sheet.addRow([result.costGroup?.code ?? null, result.nature?.code ?? null, result.nature?.name ?? result.resultCode, result.resultType, null, result.ruleCode, result.amount.toString(), `result.${result.resultCode}.${item.path}`, item.value]);
  }
  const headerRow = metadata.length + 2;
  sheet.getRow(headerRow).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, sheet.rowCount), column: 9 } };
  [16,14,32,14,14,30,18,55,55].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getColumn(7).numFmt = ACCOUNTING_FORMAT;
}

function addSourceSheet(workbook: ExcelJS.Workbook, name: string, rows: SourceRow[], required = false) {
  if (!rows.length) { if (required) throw new Error(`Persisted audit source ${name} tidak tersedia.`); return; }
  const sheet = workbook.addWorksheet(name);
  if (rows.every((row) => AUDIT_TEMPLATE_CODES.has(row.logicalSourceCode))) writeRawMatrix(sheet, rows); else writeNormalizedSource(sheet, rows);
}

function uniqueReferenceSheetName(workbook: ExcelJS.Workbook, originalName: string) {
  const clean = (originalName.trim() || 'reference').slice(0, 31);
  if (!workbook.getWorksheet(clean)) return clean;
  for (let index = 1; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `ref_${clean}`.slice(0, 31 - suffix.length) + suffix;
    if (!workbook.getWorksheet(candidate)) return candidate;
  }
  throw new Error(`Nama worksheet referensi tidak dapat dibuat unik: ${originalName}`);
}

function addPersistedReferenceSheets(workbook: ExcelJS.Workbook, rows: SourceRow[]) {
  const grouped = new Map<string, SourceRow[]>();
  for (const row of rows) grouped.set(row.originalSheetName, [...(grouped.get(row.originalSheetName) ?? []), row]);
  for (const [originalName, sourceRows] of grouped) {
    const sheet = workbook.addWorksheet(uniqueReferenceSheetName(workbook, originalName));
    writeRawMatrix(sheet, sourceRows);
  }
}

export async function buildCostStructureExport(periodId: number) {
  const run = await loadExportRun(periodId);
  if (!run) throw new Error('Active SUCCESS calculation run tidak ditemukan.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIG ACTIVA'; workbook.created = new Date();
  const allRows = run.upload.sourceRows as SourceRow[];

  if (run.period.company.companyCode === '7000') {
    writeCompany7000Ghopo(workbook, run);
    const derivRows = rowsByCode(allRows, 'AUDIT_DERIV');
    const hasDeriv = derivRows.length > 0;
    if (hasDeriv) { const deriv = workbook.addWorksheet('DERIV'); writeRawMatrix(deriv, derivRows); }
    else writeZeroDerivSheet(workbook, run);
    const rincian = workbook.addWorksheet('rincian biaya'); writeRawMatrix(rincian, requireAuditRows(allRows, 'AUDIT_RINCIAN', 'rincian biaya'));
    addSourceSheet(workbook, 'tb', rowsByCode(allRows, 'TB'), true);
    addSourceSheet(workbook, 'cc_prod', rowsByCode(allRows, 'CC_PROD'), true);
    addSourceSheet(workbook, 'cc_adm', rowsByCode(allRows, 'CC_ADUM'), true);
    addSourceSheet(workbook, 'cc pasar', rowsByCode(allRows, 'CC_PASAR'), true);
    addSourceSheet(workbook, 'cc_drv', rowsByCode(allRows, 'AUDIT_CC_DRV'));
    const si2000DrvRows = rowsByCode(allRows, 'AUDIT_SI2000_DRV');
    if (hasDeriv) addSourceSheet(workbook, 'SI2000_DRV', requireAuditRows(allRows, 'AUDIT_SI2000_DRV', 'SI2000_DRV'), true);
    else addSourceSheet(workbook, 'SI2000_DRV', si2000DrvRows);
    addSourceSheet(workbook, 'WHRPG', rowsByCode(allRows, 'CC_WHRPG'), true);
    addSourceSheet(workbook, 'Batu bara', rowsByCode(allRows, 'COAL'), true);
    addSourceSheet(workbook, 'statistical pasar', rowsByCode(allRows, 'OA_STAT'), true);
    addSourceSheet(workbook, 'beli', rowsByCode(allRows, 'CLINKER_PURCHASE'), true);
    addSourceSheet(workbook, 'solar PP order', rowsByCode(allRows, 'SOLAR_PP_ORDER'), true);
  } else {
    writeCompany2000Si(workbook, run);
    const rincian = workbook.addWorksheet('rincian biaya'); writeRawMatrix(rincian, requireAuditRows(allRows, 'AUDIT_RINCIAN', 'rincian biaya'));
    addSourceSheet(workbook, 'tb', rowsByCode(allRows, 'TB'), true);
    addSourceSheet(workbook, 'cc prod', rowsByCode(allRows, 'CC_PROD'));
    addSourceSheet(workbook, 'cc ADM', rowsByCode(allRows, 'CC_ADUM'), true);
    addSourceSheet(workbook, 'cc pasar', rowsByCode(allRows, 'CC_PASAR'), true);
    addSourceSheet(workbook, 'cc derivatif', rowsByCode(allRows, 'AUDIT_CC_DRV'));
  }
  writeFormulaAudit(workbook, run);
  addPersistedReferenceSheets(workbook, rowsByCode(allRows, 'AUDIT_REFERENCE'));
  // Styling is static and style-only; all values above came from the active persisted SUCCESS run.
  applyWorkbookStyleBlueprint(workbook, getWorkbookStyleBlueprint(run.period.company.companyCode));

  const buffer = await workbook.xlsx.writeBuffer();
  const company = run.period.company.companyCode;
  const period = `${run.period.fiscalYear}-${String(run.period.fiscalPeriod).padStart(2, '0')}`;
  const designation = run.period.status === 'FINALIZED' ? 'FINAL' : 'DRAFT';
  return {
    buffer: Buffer.from(buffer),
    runId: run.id,
    status: run.period.status,
    fileName: `Cost_Structure_${company}_${period}_${designation}.xlsx`,
  };
}

export async function recordCostStructureExport(periodId: number, runId: number, status: string, userId: number) {
  await prisma.costAuditLog.create({
    data: {
      userId,
      periodId,
      action: 'EXPORT_COST_STRUCTURE',
      entityType: 'CostCalculationRun',
      entityId: String(runId),
      newValueJson: { runId, periodStatus: status, designation: status === 'FINALIZED' ? 'OFFICIAL' : 'DRAFT', source: 'PERSISTED_DB_ONLY' },
      reason: 'Excel export rendered from persisted calculation/source lineage; no accounting recalculation or Storage read.',
    },
  });
}
