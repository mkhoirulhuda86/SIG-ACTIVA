/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { evaluateRawV2ExportEligibility, selectOperationalStageE, STAGE_E_IDENTITY } from './report';

const money = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;
const jsonRun = (run: any) => ({
  ...run,
  results: run.results.map((row: any) => ({ ...row, amount: money(row.amount) })),
  controls: run.controls.map((row: any) => ({ ...row, sourceAmount: money(row.sourceAmount), accountedAmount: money(row.accountedAmount), difference: money(row.difference) })),
  analyticalRows: run.analyticalRows.map((row: any) => ({ ...row, rawAmount: money(row.rawAmount), mappedAmount: money(row.mappedAmount) })),
});

export async function getRawV2OperationalReport(fiscalYear: number, fiscalPeriod: number) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.costRawV2Period.findUnique({
      where: { companyCode_fiscalYear_fiscalPeriod: { companyCode: '2000', fiscalYear, fiscalPeriod } },
      include: { uploads: { where: { isActiveVersion: true }, include: { sources: { orderBy: { logicalSourceCode: 'asc' } }, validationIssues: { where: { resolved: false }, orderBy: { createdAt: 'asc' } } }, take: 1 } },
    });
    if (!period) return null;
    const upload = period.uploads[0] ?? null;
    const runs = await tx.costRawV2CalculationRun.findMany({
      where: { periodId: period.id },
      orderBy: [{ runNumber: 'desc' }],
      include: {
        reconciliation: true,
        results: { orderBy: { resultCode: 'asc' } },
        controls: { orderBy: { controlCode: 'asc' } },
        analyticalRows: { orderBy: [{ logicalSourceCode: 'asc' }, { sourceRowNumber: 'asc' }, { id: 'asc' }] },
      },
    });
    const stageE = upload ? selectOperationalStageE(runs, upload.id) : null;
    const operational = stageE ? runs.find((run) => run.id === stageE.id)! : null;
    const stageD = upload ? runs.find((run) => run.uploadId === upload.id && run.reconciliation) ?? null : null;
    const natureIds = operational?.results.flatMap((row) => row.natureId ? [row.natureId] : []) ?? [];
    const natures = natureIds.length ? await tx.costNature.findMany({ where: { id: { in: natureIds } }, select: { id: true, name: true } }) : [];
    const natureNames = Object.fromEntries(natures.map((nature) => [nature.id, nature.name]));
    const run = operational ? jsonRun(operational) : null;
    const resultAmount = (code: string) => operational?.results.find((row) => row.resultCode === code)?.amount.toString() ?? null;
    const analyticalTotal = (klass: string) => operational?.analyticalRows.filter((row) => row.analyticalClass === klass).reduce((total, row) => total.plus(row.mappedAmount), new Prisma.Decimal(0)).toString() ?? null;
    const derivCoverage = operational?.controls.find((row) => row.sourceLogicalCode === 'CC_DERIV' && row.controlCode.endsWith('_MAPPING_COMPLETENESS'))?.metricsJson as any;
    const exportEligibility = evaluateRawV2ExportEligibility({ companyCode: period.companyCode, activeUploadId: upload?.id ?? null, run: operational });
    return {
      period: { id: period.id, companyCode: period.companyCode, fiscalYear, fiscalPeriod, status: period.status },
      upload: upload && { ...upload, fileSizeBytes: upload.fileSizeBytes.toString(), sources: upload.sources.map((source) => ({ ...source, detailTotal: money(source.detailTotal), debitControl: money(source.debitControl), overUnderControl: money(source.overUnderControl), reconciliationDifference: money(source.reconciliationDifference) })) },
      stageD: stageD?.reconciliation ? { runId: stageD.id, runNumber: stageD.runNumber, status: stageD.status, reconciliation: { ...stageD.reconciliation, totalAdum: money(stageD.reconciliation.totalAdum), totalPasar: money(stageD.reconciliation.totalPasar), totalBaseCc: money(stageD.reconciliation.totalBaseCc), totalTbPopulation: money(stageD.reconciliation.totalTbPopulation), totalDifference: money(stageD.reconciliation.totalDifference), derivTotal: money(stageD.reconciliation.derivTotal), derivDebitControl: money(stageD.reconciliation.derivDebitControl), derivSourceDifference: money(stageD.reconciliation.derivSourceDifference) } } : null,
      run: run && { ...run, results: run.results.map((result: any) => ({ ...result, natureName: result.natureId ? natureNames[result.natureId] ?? null : null })) },
      executive: operational ? { finalAdum: resultAmount('GROUP:ADUM'), finalPasar: resultAmount('GROUP:PASAR'), finalCompanySi: resultAmount('COMPANY:SI'), stageDDifference: stageD?.reconciliation?.totalDifference.toString() ?? null, rincianAdumCorrection: analyticalTotal('RINCIAN_ADUM_DELTA'), derivRaw: stageD?.reconciliation?.derivTotal.toString() ?? null, derivContributing: new Prisma.Decimal(derivCoverage?.include?.amount ?? 0).plus(derivCoverage?.reclass?.amount ?? 0).toString(), derivExcluded: String(derivCoverage?.exclude?.amount ?? '0'), derivSiOffset: analyticalTotal('DERIV_PASAR_OFFSET') } : null,
      issues: upload?.validationIssues ?? [],
      history: runs.map((item) => ({ id: item.id, runNumber: item.runNumber, uploadId: item.uploadId, uploadVersion: item.sourceSnapshotJson && typeof item.sourceSnapshotJson === 'object' && !Array.isArray(item.sourceSnapshotJson) ? (item.sourceSnapshotJson as any).uploadVersion ?? null : null, stage: item.sourceSnapshotJson && typeof item.sourceSnapshotJson === 'object' && !Array.isArray(item.sourceSnapshotJson) ? (item.sourceSnapshotJson as any).stage ?? null : null, status: item.status, isActive: item.isActive, ruleSetVersion: item.ruleSetVersion, startedAt: item.startedAt, completedAt: item.completedAt, errorMessage: item.errorMessage, resultCount: item.results.length, controlCount: item.controls.length, analyticalRowCount: item.analyticalRows.length })),
      exportEligibility,
      stageIdentity: STAGE_E_IDENTITY,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
