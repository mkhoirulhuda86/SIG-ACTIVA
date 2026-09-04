import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RAW_V2_RULE_SETS } from './constants';
import { reconcileCompany2000 } from './reconciliation';

export class RawV2CalculationEligibilityError extends Error {}

export async function calculateRawV2Company2000(input: { fiscalYear: number; fiscalPeriod: number; startedById: number }) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.costRawV2Period.findUnique({
      where: { companyCode_fiscalYear_fiscalPeriod: { companyCode: '2000', fiscalYear: input.fiscalYear, fiscalPeriod: input.fiscalPeriod } },
      include: { uploads: { where: { isActiveVersion: true }, include: { sources: true }, take: 1 } },
    });
    if (!period) throw new RawV2CalculationEligibilityError('Raw V2 period Company 2000 tidak ditemukan.');
    const upload = period.uploads[0];
    if (!upload || upload.status !== 'VALIDATED') throw new RawV2CalculationEligibilityError('Active VALIDATED upload diperlukan.');
    const unresolvedErrors = await tx.costRawV2ValidationIssue.count({ where: { uploadId: upload.id, severity: 'ERROR', resolved: false } });
    if (unresolvedErrors) throw new RawV2CalculationEligibilityError('Upload memiliki unresolved ERROR issue.');
    const sourceByCode = new Map(upload.sources.map((source) => [source.logicalSourceCode, source]));
    for (const code of ['TB', 'CC_ADUM', 'CC_PASAR']) {
      if (sourceByCode.get(code)?.presenceStatus !== 'PRESENT') throw new RawV2CalculationEligibilityError(`Required source ${code} tidak tersedia.`);
    }
    for (const code of ['CC_ADUM', 'CC_PASAR', 'CC_DERIV']) {
      const source = sourceByCode.get(code);
      if (source?.presenceStatus === 'PRESENT' && (!source.reconciliationDifference || !source.reconciliationDifference.isZero()))
        throw new RawV2CalculationEligibilityError(`${code} source control tidak reconcile.`);
    }
    const sourceRows = await tx.costRawV2SourceRow.findMany({
      where: { uploadId: upload.id, logicalSourceCode: { in: ['TB', 'CC_ADUM', 'CC_PASAR', 'CC_DERIV'] }, coaCodeRaw: { not: null }, amount: { not: null } },
      orderBy: [{ logicalSourceCode: 'asc' }, { sourceRowNumber: 'asc' }],
    });
    const deriv = sourceByCode.get('CC_DERIV');
    const result = reconcileCompany2000(sourceRows, deriv ? {
      presenceStatus: deriv.presenceStatus, detailRowCount: deriv.detailRowCount,
      nonZeroDetailRowCount: deriv.nonZeroDetailRowCount, detailTotal: deriv.detailTotal,
      debitControl: deriv.debitControl, reconciliationDifference: deriv.reconciliationDifference,
    } : { presenceStatus: 'ABSENT_TREATED_AS_ZERO', detailRowCount: 0, nonZeroDetailRowCount: 0, detailTotal: new Prisma.Decimal(0), debitControl: null, reconciliationDifference: new Prisma.Decimal(0) });
    const latest = await tx.costRawV2CalculationRun.aggregate({ where: { periodId: period.id }, _max: { runNumber: true } });
    const run = await tx.costRawV2CalculationRun.create({ data: {
      periodId: period.id, uploadId: upload.id, runNumber: (latest._max.runNumber ?? 0) + 1,
      status: 'RUNNING', isActive: false, ruleSetVersion: RAW_V2_RULE_SETS['2000'], startedById: input.startedById,
      sourceSnapshotJson: { uploadId: upload.id, uploadVersion: upload.version, sourceIds: upload.sources.map((source) => source.id) },
    }});
    const reconciliation = await tx.costRawV2Reconciliation.create({ data: {
      calculationRunId: run.id, status: result.status, tbRowCount: result.tbRowCount, tbNonZeroCount: result.tbNonZeroCount,
      uniqueCcCoaCount: result.uniqueCcCoaCount, foundInTbCount: result.foundInTbCount, missingInTbCount: result.missingInTbCount,
      exactMatchCount: result.exactMatchCount, mismatchCount: result.mismatchCount, totalAdum: result.totalAdum,
      totalPasar: result.totalPasar, totalBaseCc: result.totalBaseCc, totalTbPopulation: result.totalTbPopulation,
      totalDifference: result.totalDifference, derivPresenceStatus: result.deriv.presenceStatus,
      derivDetailRowCount: result.deriv.detailRowCount, derivNonZeroCount: result.deriv.nonZeroCount, derivTotal: result.deriv.total,
      derivDebitControl: result.deriv.debitControl, derivSourceDifference: result.deriv.sourceDifference,
      derivPasarCoverageMissing: result.deriv.pasarCoverageMissing,
      rows: { create: result.details.map((row) => ({ coaCode: row.coaCode, adumAmount: row.adumAmount, pasarAmount: row.pasarAmount, ccAmount: row.ccAmount, tbAmount: row.tbAmount, difference: row.difference, status: row.status })) },
    }});
    const analyticalRows = sourceRows.filter((row) => row.logicalSourceCode !== 'TB');
    if (analyticalRows.length) await tx.costRawV2AnalyticalRow.createMany({ data: analyticalRows.map((row) => ({
      calculationRunId: run.id, sourceRowId: row.id, logicalSourceCode: row.logicalSourceCode,
      originalSheetName: row.originalSheetName, sourceRowNumber: row.sourceRowNumber, coaCode: row.coaCodeRaw!,
      descriptionRaw: row.descriptionRaw, rawAmount: row.amount!, analyticalClass: row.logicalSourceCode === 'CC_DERIV' ? 'DERIV_EVIDENCE' : 'BASE_CC',
      mappedAmount: row.amount!, mappingStatus: 'PENDING_STAGE_E', ruleSetVersion: RAW_V2_RULE_SETS['2000'],
    })) });
    if (result.status === 'PASS') {
      await tx.costRawV2CalculationRun.updateMany({ where: { periodId: period.id, isActive: true }, data: { isActive: false } });
      await tx.costRawV2CalculationRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', isActive: true, completedAt: new Date() } });
      await tx.costRawV2Period.update({ where: { id: period.id }, data: { status: 'CALCULATED' } });
    } else {
      await tx.costRawV2CalculationRun.update({ where: { id: run.id }, data: { status: 'FAILED', isActive: false, completedAt: new Date(), errorMessage: 'TB = CC_ADUM + CC_PASAR per-COA reconciliation failed.' } });
    }
    return { runId: run.id, reconciliationId: reconciliation.id, status: result.status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
}
