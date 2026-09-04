import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RAW_V2_RULE_SETS } from './constants';
import { calculateCompany2000Si, type SiMapping, type SiSourceRow } from './si';

export class RawV2SiEligibilityError extends Error {}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function calculateRawV2Company2000Si(input: { fiscalYear: number; fiscalPeriod: number; startedById: number }) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.costRawV2Period.findUnique({
      where: {
        companyCode_fiscalYear_fiscalPeriod: {
          companyCode: '2000',
          fiscalYear: input.fiscalYear,
          fiscalPeriod: input.fiscalPeriod,
        },
      },
      include: { uploads: { where: { isActiveVersion: true }, include: { sources: true }, take: 1 } },
    });
    if (!period) throw new RawV2SiEligibilityError('Raw V2 period Company 2000 tidak ditemukan.');

    const upload = period.uploads[0];
    if (!upload || upload.status !== 'VALIDATED') {
      throw new RawV2SiEligibilityError('Active VALIDATED upload diperlukan.');
    }
    if (await tx.costRawV2ValidationIssue.count({ where: { uploadId: upload.id, severity: 'ERROR', resolved: false } })) {
      throw new RawV2SiEligibilityError('Upload memiliki unresolved ERROR issue.');
    }

    const byCode = new Map(upload.sources.map((source) => [source.logicalSourceCode, source]));
    for (const code of ['TB', 'CC_ADUM', 'CC_PASAR']) {
      if (byCode.get(code)?.presenceStatus !== 'PRESENT') {
        throw new RawV2SiEligibilityError(`Required source ${code} tidak tersedia.`);
      }
    }
    for (const code of ['CC_ADUM', 'CC_PASAR', 'CC_DERIV']) {
      const source = byCode.get(code);
      if (source?.presenceStatus === 'PRESENT' && !source.reconciliationDifference?.isZero()) {
        throw new RawV2SiEligibilityError(`${code} source control tidak reconcile.`);
      }
    }

    const stageD = await tx.costRawV2CalculationRun.findFirst({
      where: { uploadId: upload.id, reconciliation: { isNot: null } },
      orderBy: { startedAt: 'desc' },
      include: { reconciliation: true },
    });
    if (!stageD?.reconciliation) {
      throw new RawV2SiEligibilityError('Stage D reconciliation untuk active upload diperlukan.');
    }
    if (stageD.reconciliation.missingInTbCount || stageD.reconciliation.derivPasarCoverageMissing) {
      throw new RawV2SiEligibilityError('Stage D memiliki missing TB atau DERIV-in-PASAR blocker.');
    }

    const dbRows = await tx.costRawV2SourceRow.findMany({
      where: {
        uploadId: upload.id,
        logicalSourceCode: { in: ['TB', 'CC_ADUM', 'CC_PASAR', 'CC_DERIV'] },
        coaCodeResolved: { not: null },
        amount: { not: null },
      },
      orderBy: [{ logicalSourceCode: 'asc' }, { sourceRowNumber: 'asc' }, { id: 'asc' }],
    });

    const company = await tx.costCompany.findUnique({ where: { companyCode: '2000' } });
    if (!company) throw new RawV2SiEligibilityError('Company 2000 master tidak ditemukan.');

    const effectiveDate = new Date(Date.UTC(input.fiscalYear, input.fiscalPeriod - 1, 1));
    const dbMappings = await tx.costCoaMapping.findMany({
      where: {
        companyId: company.id,
        sourceLogicalCode: { in: ['CC_ADUM', 'CC_PASAR'] },
        active: true,
        validFrom: { lte: effectiveDate },
        OR: [{ validTo: null }, { validTo: { gte: effectiveDate } }],
      },
      include: { coa: true, costGroup: true, nature: true },
      orderBy: { id: 'asc' },
    });

    const rows: SiSourceRow[] = dbRows.map((row) => ({
      id: row.id,
      logicalSourceCode: row.logicalSourceCode,
      originalSheetName: row.originalSheetName,
      sourceRowNumber: row.sourceRowNumber,
      coaCode: row.coaCodeResolved!,
      descriptionRaw: row.descriptionRaw,
      amount: row.amount!,
    }));
    const mappings: SiMapping[] = dbMappings.map((mapping) => ({
      id: mapping.id,
      sourceLogicalCode: mapping.sourceLogicalCode,
      coaCode: mapping.coa.coaCode,
      action: mapping.mappingAction,
      groupId: mapping.costGroupId,
      groupCode: mapping.costGroup?.code ?? null,
      natureId: mapping.natureId,
      natureCode: mapping.nature?.code ?? null,
      natureCalculationType: mapping.nature?.calculationType ?? null,
      groupActive: mapping.costGroup?.active ?? null,
      natureActive: mapping.nature?.active ?? null,
      validFrom: mapping.validFrom,
      validTo: mapping.validTo,
      active: mapping.active,
      updatedAt: mapping.updatedAt,
      note: mapping.note,
    }));

    const result = calculateCompany2000Si({ rows, mappings, effectiveDate });
    const latest = await tx.costRawV2CalculationRun.aggregate({ where: { periodId: period.id }, _max: { runNumber: true } });
    const snapshotMappings = result.mappingsUsed.map((mapping) => ({
      id: mapping.id,
      sourceLogicalCode: mapping.sourceLogicalCode,
      coaCode: mapping.coaCode,
      mappingAction: mapping.action,
      costGroupId: mapping.groupId,
      costGroupCode: mapping.groupCode,
      natureId: mapping.natureId,
      natureCode: mapping.natureCode,
      natureCalculationType: mapping.natureCalculationType,
      validFrom: mapping.validFrom.toISOString(),
      validTo: mapping.validTo?.toISOString() ?? null,
      updatedAt: mapping.updatedAt.toISOString(),
      note: mapping.note ?? null,
    }));

    const run = await tx.costRawV2CalculationRun.create({
      data: {
        periodId: period.id,
        uploadId: upload.id,
        runNumber: (latest._max.runNumber ?? 0) + 1,
        status: 'RUNNING',
        isActive: false,
        ruleSetVersion: RAW_V2_RULE_SETS['2000'],
        startedById: input.startedById,
        sourceSnapshotJson: json({
          stage: 'E_MAPPING_RINCIAN_SI',
          uploadId: upload.id,
          uploadVersion: upload.version,
          stageDRunId: stageD.id,
          stageDReconciliationId: stageD.reconciliation.id,
        }),
        mappingSnapshotJson: json({
          stage: 'E_MAPPING_RINCIAN_SI',
          effectiveDate: effectiveDate.toISOString(),
          mappings: snapshotMappings,
          rincianFormula: 'RINCIAN_ADUM_EQUALS_TB_MINUS_RAW_PASAR',
          derivFormula: 'CC_DERIV_NEGATIVE_PASAR',
          stageDRunId: stageD.id,
          stageDReconciliationId: stageD.reconciliation.id,
          manualAdjustmentApplied: false,
        }),
      },
    });

    await tx.costRawV2AnalyticalRow.createMany({
      data: result.analyticalRows.map((row) => ({
        calculationRunId: run.id,
        sourceRowId: row.id,
        logicalSourceCode: row.logicalSourceCode,
        originalSheetName: row.originalSheetName,
        sourceRowNumber: row.sourceRowNumber,
        coaCode: row.coaCode,
        descriptionRaw: row.descriptionRaw,
        rawAmount: row.rawAmount,
        analyticalClass: row.analyticalClass,
        mappedAmount: row.mappedAmount,
        mappingStatus: row.mappingStatus,
        mappingAction: row.mapping?.action,
        mappingId: row.mapping?.id,
        costGroupId: row.mapping?.groupId,
        costGroupCode: row.mapping?.groupCode,
        natureId: row.mapping?.natureId,
        natureCode: row.mapping?.natureCode,
        mappingEffectiveDate: effectiveDate,
        ruleCode: row.ruleCode,
        referenceJson: json(row.reference),
        ruleSetVersion: RAW_V2_RULE_SETS['2000'],
      })),
    });

    const controls: Prisma.CostRawV2ControlCreateManyInput[] = Object.entries(result.coverageBySource).map(
      ([source, coverage]) => ({
        calculationRunId: run.id,
        controlCode: `${source}_MAPPING_COMPLETENESS`,
        sourceLogicalCode: source,
        status: coverage.difference.isZero() ? 'PASS' : 'FAIL',
        sourceAmount: coverage.sourceAmount,
        accountedAmount: coverage.accountedAmount,
        difference: coverage.difference,
        metricsJson: json({
          nonZeroCount: coverage.nonZeroCount,
          include: { count: coverage.include.count, amount: coverage.include.amount.toString() },
          exclude: { count: coverage.exclude.count, amount: coverage.exclude.amount.toString() },
          reclass: { count: coverage.reclass.count, amount: coverage.reclass.amount.toString() },
          unmapped: { count: coverage.unmapped.count, amount: coverage.unmapped.amount.toString() },
          ambiguous: { count: coverage.ambiguous.count, amount: coverage.ambiguous.amount.toString() },
          invalidTarget: { count: coverage.invalidTarget.count, amount: coverage.invalidTarget.amount.toString() },
        }),
      })
    );

    const zero = new Prisma.Decimal(0);
    const mapped = (klass: string) =>
      result.analyticalRows.filter((row) => row.analyticalClass === klass).reduce((value, row) => value.plus(row.mappedAmount), zero);
    const rawAdum = result.analyticalRows
      .filter((row) => row.ruleCode === 'RAW_BASE_ADUM')
      .reduce((value, row) => value.plus(row.rawAmount), zero);
    const rawPasar = result.analyticalRows
      .filter((row) => row.ruleCode === 'RAW_BASE_PASAR')
      .reduce((value, row) => value.plus(row.rawAmount), zero);
    const delta = result.analyticalRows
      .filter((row) => row.ruleCode === 'RINCIAN_ADUM_RESIDUAL')
      .reduce((value, row) => value.plus(row.rawAmount), zero);
    const derivOffset = mapped('DERIV_PASAR_OFFSET');
    const adumNature = result.natureTotals
      .filter((nature) => nature.groupCode === 'ADUM')
      .reduce((value, nature) => value.plus(nature.amount), zero);
    const pasarNature = result.natureTotals
      .filter((nature) => nature.groupCode === 'PASAR')
      .reduce((value, nature) => value.plus(nature.amount), zero);

    const controlValues: [string, Prisma.Decimal, Prisma.Decimal][] = [
      ['RINCIAN_ADUM_RECONCILIATION', rawAdum.plus(delta), rawAdum.plus(delta)],
      ['RINCIAN_PASAR_RECONCILIATION', rawPasar, rawPasar],
      ['DERIV_MAPPING_RECONCILIATION', derivOffset, derivOffset],
      ['ADUM_NATURE_RECONCILIATION', result.adumTotal, adumNature],
      ['PASAR_NATURE_RECONCILIATION', result.pasarTotal, pasarNature],
      ['SI_ADUM_RECONCILIATION', mapped('BASE_CC_ADUM').plus(mapped('RINCIAN_ADUM_DELTA')), result.adumTotal],
      ['SI_PASAR_RECONCILIATION', mapped('BASE_CC_PASAR').plus(derivOffset), result.pasarTotal],
      ['SI_COMPANY_RECONCILIATION', result.adumTotal.plus(result.pasarTotal), result.companyTotal],
    ];
    controls.push(
      ...controlValues.map(([controlCode, sourceAmount, accountedAmount]) => {
        const difference = sourceAmount.minus(accountedAmount);
        return {
          calculationRunId: run.id,
          controlCode,
          sourceLogicalCode: null,
          status: difference.isZero() ? 'PASS' : 'FAIL',
          sourceAmount,
          accountedAmount,
          difference,
          metricsJson: json({ issues: result.issues }),
        };
      })
    );
    await tx.costRawV2Control.createMany({ data: controls });

    await tx.costRawV2Result.createMany({
      data: [
        ...result.natureTotals.map((nature) => ({
          calculationRunId: run.id,
          resultLevel: 'NATURE',
          resultCode: `NATURE:${nature.groupCode}:${nature.natureCode}`,
          costGroupId: nature.groupId,
          costGroupCode: nature.groupCode,
          natureId: nature.natureId,
          natureCode: nature.natureCode,
          amount: nature.amount,
        })),
        { calculationRunId: run.id, resultLevel: 'COST_GROUP', resultCode: 'GROUP:ADUM', costGroupCode: 'ADUM', amount: result.adumTotal },
        { calculationRunId: run.id, resultLevel: 'COST_GROUP', resultCode: 'GROUP:PASAR', costGroupCode: 'PASAR', amount: result.pasarTotal },
        { calculationRunId: run.id, resultLevel: 'COMPANY', resultCode: 'COMPANY:SI', amount: result.companyTotal },
      ],
    });

    if (result.success) {
      await tx.costRawV2CalculationRun.updateMany({ where: { periodId: period.id, isActive: true }, data: { isActive: false } });
      await tx.costRawV2CalculationRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', isActive: true, completedAt: new Date() },
      });
      await tx.costRawV2Period.update({ where: { id: period.id }, data: { status: 'CALCULATED' } });
    } else {
      await tx.costRawV2CalculationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: result.issues.map((issue) => `${issue.code}:${issue.source}:${issue.coaCode}`).join('; ').slice(0, 1000),
        },
      });
    }

    return {
      runId: run.id,
      status: result.success ? 'SUCCESS' : 'FAILED',
      issues: result.issues,
      totals: {
        adum: result.adumTotal.toString(),
        pasar: result.pasarTotal.toString(),
        company: result.companyTotal.toString(),
      },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
}
