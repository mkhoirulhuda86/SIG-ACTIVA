/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';

const MONEY_FORMAT = '#,##0.00;[Red](#,##0.00);-';
const safeText = (value: unknown) => {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const numericMoney = (value: string | null | undefined) => {
  if (value == null) return null;
  const decimal = new Prisma.Decimal(value);
  const number = decimal.toNumber();
  if (!Number.isFinite(number) || !new Prisma.Decimal(number.toString()).eq(decimal)) {
    throw new Error(`Financial value cannot be represented safely in Excel numeric format: ${value}`);
  }
  return number;
};
const sum = (values: (string | null | undefined)[]) => values.reduce((total, value) => total.plus(value ?? 0), new Prisma.Decimal(0)).toString();

function table(sheet: ExcelJS.Worksheet, headers: string[], rows: unknown[][], moneyColumns: number[] = []) {
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map((value) => typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value) ? safeText(value) : value));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  moneyColumns.forEach((index) => { sheet.getColumn(index).numFmt = MONEY_FORMAT; });
  sheet.columns.forEach((column) => { column.width = 22; });
}

export function reportExecutiveValues(report: any) {
  if (report.executive) return report.executive;
  const result = (code: string) => report.run?.results.find((item: any) => item.resultCode === code)?.amount ?? null;
  const analytical = (klass: string) => report.run?.analyticalRows.filter((item: any) => item.analyticalClass === klass).map((item: any) => item.mappedAmount) ?? [];
  const coverage = (source: string) => report.run?.controls.find((item: any) => item.sourceLogicalCode === source && item.controlCode.endsWith('_MAPPING_COMPLETENESS'))?.metricsJson ?? {};
  return {
    finalAdum: result('GROUP:ADUM'), finalPasar: result('GROUP:PASAR'), finalCompanySi: result('COMPANY:SI'),
    stageDDifference: report.stageD?.reconciliation.totalDifference ?? null,
    rincianAdumCorrection: sum(analytical('RINCIAN_ADUM_DELTA')),
    derivRaw: report.stageD?.reconciliation.derivTotal ?? null,
    derivContributing: coverage('CC_DERIV').include?.amount ? sum([coverage('CC_DERIV').include.amount, coverage('CC_DERIV').reclass?.amount]) : '0',
    derivExcluded: coverage('CC_DERIV').exclude?.amount ?? '0',
    derivSiOffset: sum(analytical('DERIV_PASAR_OFFSET')),
  };
}

export async function buildRawV2ReportWorkbook(report: any, generatedAt = new Date()) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIG ACTIVA'; workbook.created = generatedAt;
  const values = reportExecutiveValues(report);
  const summary = workbook.addWorksheet('Summary');
  table(summary, ['Field', 'Value', 'Exact value'], [
    ['Company', report.period.companyCode, report.period.companyCode], ['Fiscal year', report.period.fiscalYear, String(report.period.fiscalYear)], ['Fiscal period', report.period.fiscalPeriod, String(report.period.fiscalPeriod)],
    ['Active upload ID/version', `${report.upload.id} / ${report.upload.version}`, `${report.upload.id} / ${report.upload.version}`], ['Active Stage E run ID/number', `${report.run.id} / ${report.run.runNumber}`, `${report.run.id} / ${report.run.runNumber}`],
    ['Ruleset', report.run.ruleSetVersion, report.run.ruleSetVersion], ['Run / period status', `${report.run.status} / ${report.period.status}`, `${report.run.status} / ${report.period.status}`],
    ...Object.entries({ 'Final ADUM': values.finalAdum, 'Final PASAR': values.finalPasar, 'Final Company SI': values.finalCompanySi, 'Stage D difference': values.stageDDifference, 'Rincian ADUM Delta': values.rincianAdumCorrection, 'DERIV raw': values.derivRaw, 'DERIV contributing': values.derivContributing, 'DERIV excluded': values.derivExcluded, 'DERIV SI offset': values.derivSiOffset }).map(([label, value]) => [label, numericMoney(value), value]),
    ['Generated timestamp', generatedAt.toISOString(), generatedAt.toISOString()],
  ], [2]);
  const natureRows = report.run.results.filter((row: any) => row.resultLevel === 'NATURE');
  table(workbook.addWorksheet('Nature'), ['Cost Group', 'Nature code', 'Nature name', 'Amount', 'Exact amount', 'Run ID', 'Ruleset'], natureRows.map((row: any) => [row.costGroupCode, row.natureCode, row.natureName, numericMoney(row.amount), row.amount, report.run.id, report.run.ruleSetVersion]), [4]);
  const mapping = report.run.controls.filter((row: any) => row.controlCode.endsWith('_MAPPING_COMPLETENESS'));
  table(workbook.addWorksheet('Mapping Coverage'), ['Population', 'Non-zero', 'Include count', 'Include amount', 'Exclude count', 'Exclude amount', 'Reclass count', 'Reclass amount', 'Unmapped count', 'Unmapped amount', 'Ambiguous count', 'Ambiguous amount', 'Invalid target count', 'Invalid target amount', 'Source', 'Accounted', 'Difference', 'Status'], mapping.map((row: any) => { const m=row.metricsJson??{}; return [row.sourceLogicalCode,m.nonZeroCount??0,m.include?.count??0,numericMoney(m.include?.amount),m.exclude?.count??0,numericMoney(m.exclude?.amount),m.reclass?.count??0,numericMoney(m.reclass?.amount),m.unmapped?.count??0,numericMoney(m.unmapped?.amount),m.ambiguous?.count??0,numericMoney(m.ambiguous?.amount),m.invalidTarget?.count??0,numericMoney(m.invalidTarget?.amount),numericMoney(row.sourceAmount),numericMoney(row.accountedAmount),numericMoney(row.difference),row.status]; }), [4,6,8,10,12,14,15,16,17]);
  table(workbook.addWorksheet('Controls'), ['Code','Population','Source','Accounted','Difference','Status','Metrics/evidence'], report.run.controls.map((row:any)=>[row.controlCode,row.sourceLogicalCode,numericMoney(row.sourceAmount),numericMoney(row.accountedAmount),numericMoney(row.difference),row.status,JSON.stringify(row.metricsJson??{})]), [3,4,5]);
  table(workbook.addWorksheet('Analytical Lineage'), ['Logical source','Original sheet','Source row','COA','Description','Raw amount','Raw exact','SI contribution','Contribution exact','Class','Mapping status','Action','Cost Group','Nature','Rule','Mapping ID','Effective date','Reference lineage'], report.run.analyticalRows.map((row:any)=>[row.logicalSourceCode,row.originalSheetName,row.sourceRowNumber,row.coaCode,row.descriptionRaw,numericMoney(row.rawAmount),row.rawAmount,numericMoney(row.mappedAmount),row.mappedAmount,row.analyticalClass,row.mappingStatus,row.mappingAction,row.costGroupCode,row.natureCode,row.ruleCode,row.mappingId,row.mappingEffectiveDate,JSON.stringify(row.referenceJson??{})]), [6,8]);
  table(workbook.addWorksheet('Run History'), ['Run number','Run ID','Stage','Upload ID','Upload version','Status','Active','Ruleset','Started','Completed','Error/invalidation','Results','Controls','Analytical rows'], report.history.map((row:any)=>[row.runNumber,row.id,row.stage,row.uploadId,row.uploadVersion,row.status,row.isActive?'ACTIVE':'INACTIVE',row.ruleSetVersion,row.startedAt,row.completedAt,row.errorMessage,row.resultCount,row.controlCount,row.analyticalRowCount]));
  return workbook;
}
