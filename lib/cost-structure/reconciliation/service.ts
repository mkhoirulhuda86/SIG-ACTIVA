import 'server-only';
import { Prisma, CostPeriodStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { classifySourceRow } from './source-control-registry';
import { reconcileCcGroup } from './reconcile-cc-group';
import { calculateMappingCompleteness } from './mapping-completeness';
import { isMappingBlockingAmount } from './money';
import { applyCompany2000HistoricalSourcePolicy, evaluateCompany2000HistoricalSupport } from './company-2000-source-control-policy';
import {
  buildIssueBatch,
  MAPPING_ISSUE_CODES,
  SOURCE_CONTROL_CODES,
  type DesiredIssueMap,
  type IssueSeverity,
} from './issue-batch';

const required = (company: string) => company === '7000'
  ? ['CC_PROD', 'CC_ADUM', 'CC_PASAR', 'CC_WHRPG']
  : ['CC_ADUM', 'CC_PASAR'];

const sourceControlCodes = [...SOURCE_CONTROL_CODES];
const mappingIssueCodes = [...MAPPING_ISSUE_CODES];
const phaseDCodes: string[] = [...sourceControlCodes, ...mappingIssueCodes];
const mappingBlockingCodes = new Set(['MAPPING_AMBIGUOUS', 'MAPPING_OVERLAP', 'MAPPING_TARGET_INVALID']);

// Phase D can legitimately touch hundreds of distinct COAs in one upload.
// Prisma's default 5s interactive-transaction timeout is too short for that
// workload, especially when mapping issues need to be synchronized row by row.
const reconciliationTransactionOptions = {
  maxWait: 10_000,
  timeout: 60_000,
};

function setSourceIssue(
  desired: DesiredIssueMap,
  source: string,
  code: string | null,
  message: string | null,
  severity: IssueSeverity = 'ERROR'
) {
  const context = `[${source}]`;
  desired.set(context, {
    sourceRowId: null,
    issueCode: code,
    severity,
    message: code && message ? `${context} ${message}` : null,
    resolutionType: 'CONTROL_RERUN_RESOLVED',
    updateMetadata: false,
  });
}

function setMappingIssue(
  desired: DesiredIssueMap,
  sourceRowId: number,
  context: string,
  code: string | null,
  severity: IssueSeverity = 'ERROR',
  message?: string
) {
  desired.set(context, {
    sourceRowId,
    issueCode: code,
    severity,
    message: code ? `${context} ${message ?? 'Mapping source memerlukan resolusi.'}` : null,
    resolutionType: 'MAPPING_RERUN_RESOLVED',
    updateMetadata: true,
  });
}

async function persistIssueBatch(tx: Prisma.TransactionClient, uploadId: number, desired: DesiredIssueMap) {
  const existing = await tx.costValidationIssue.findMany({
    where: { uploadId, issueCode: { in: phaseDCodes }, resolved: false },
    select: { id: true, sourceRowId: true, issueCode: true, severity: true, message: true },
  });
  const batch = buildIssueBatch(uploadId, existing, desired);
  const resolvedAt = new Date();
  for (const [resolutionType, ids] of batch.resolve) {
    if (ids.length) {
      await tx.costValidationIssue.updateMany({
        where: { id: { in: ids } },
        data: { resolved: true, resolutionType, resolvedAt },
      });
    }
  }
  if (batch.create.length) await tx.costValidationIssue.createMany({ data: batch.create });
  if (batch.update.length) {
    await tx.$executeRaw`
      UPDATE "cost_validation_issues" AS issue
      SET "sourceRowId" = desired."sourceRowId",
          "severity" = desired."severity"::"CostValidationSeverity",
          "message" = desired."message",
          "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(batch.update.map((issue) => Prisma.sql`(${issue.id}::integer, ${issue.sourceRowId}::integer, ${issue.severity}::text, ${issue.message}::text)`) )})
        AS desired("id", "sourceRowId", "severity", "message")
      WHERE issue."id" = desired."id"
    `;
  }
}

async function persistSourceRowMappings(
  tx: Prisma.TransactionClient,
  rows: Array<{ id: number; coaId: number | null; mappingStatus: string }>
) {
  if (!rows.length) return;
  await tx.$executeRaw`
    UPDATE "cost_source_rows" AS row
    SET "coaId" = desired."coaId",
        "mappingStatus" = desired."mappingStatus",
        "updatedAt" = NOW()
    FROM (VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(${row.id}::integer, ${row.coaId}::integer, ${row.mappingStatus}::text)`) )})
      AS desired("id", "coaId", "mappingStatus")
    WHERE row."id" = desired."id"
  `;
}

function targetIsValid(
  mapping: {
    mappingAction: string;
    costGroupId: number | null;
    natureId: number | null;
    costGroup: { id: number; companyId: number; active: boolean } | null;
    nature: { id: number; costGroupId: number; active: boolean; calculationType: string } | null;
  },
  companyId: number
) {
  if (mapping.mappingAction === 'EXCLUDE') return true;
  return Boolean(
    mapping.costGroupId &&
    mapping.natureId &&
    mapping.costGroup?.active &&
    mapping.costGroup.companyId === companyId &&
    mapping.nature?.active &&
    mapping.nature.calculationType === 'MAPPED' &&
    mapping.nature.costGroupId === mapping.costGroupId
  );
}

export async function runPhaseD(uploadId: number) {
  return prisma.$transaction(async (tx) => {
    const upload = await tx.costUpload.findUnique({
      where: { id: uploadId },
      include: { period: { include: { company: true } }, sourceRows: true },
    });
    if (!upload) throw new Error('Upload tidak ditemukan.');
    if (!upload.isActiveVersion) throw new Error('Hanya upload aktif yang dapat direkonsiliasi.');
    if (upload.period.status === CostPeriodStatus.FINALIZED) throw new Error('Periode FINALIZED tidak dapat diubah.');

    const historicalSupportEvidence = upload.period.company.companyCode === '2000'
      ? evaluateCompany2000HistoricalSupport(upload.sourceRows.map((row) => ({
          id: row.id,
          logicalSourceCode: row.logicalSourceCode,
          sourceRowNumber: row.sourceRowNumber,
          rawData: row.rawDataJson,
        })))
      : null;
    const results = [];
    const desiredIssues: DesiredIssueMap = new Map();
    const sourceRowMappings: Array<{ id: number; coaId: number | null; mappingStatus: string }> = [];
    for (const source of required(upload.period.company.companyCode)) {
      const rows = upload.sourceRows.filter((row) => row.logicalSourceCode === source);
      const rawResult = reconcileCcGroup(rows.map((row) => ({
        id: row.id,
        coaCodeRaw: row.coaCodeRaw,
        descriptionRaw: row.descriptionRaw,
        amount: row.amount?.toString() ?? null,
      })));
      const sourcePolicy = applyCompany2000HistoricalSourcePolicy(
        upload.period.company.companyCode,
        source,
        rawResult,
        historicalSupportEvidence
      );
      const result = sourcePolicy.result;
      results.push({
        logicalSourceCode: source,
        ...result,
        rawStatus: rawResult.status,
        controlMode: sourcePolicy.fallbackUsed ? 'RINCIAN_SI' : 'DEBIT',
      });

      const classified = rows.map((row) => ({
        row,
        kind: classifySourceRow({
          coaCodeRaw: row.coaCodeRaw,
          descriptionRaw: row.descriptionRaw,
          amount: row.amount?.toString() ?? null,
        }).kind,
      }));
      const controlIds = classified.filter((item) => item.kind !== 'DETAIL').map((item) => item.row.id);
      if (controlIds.length) {
        await tx.costSourceRow.updateMany({ where: { id: { in: controlIds } }, data: { mappingStatus: 'CONTROL_ROW' } });
        await tx.costValidationIssue.updateMany({
          where: { sourceRowId: { in: controlIds }, issueCode: 'SOURCE_ROW_MISSING_COA', resolved: false },
          data: { resolved: true, resolutionType: 'AUTO_CLASSIFIED_CONTROL_ROW', resolvedAt: new Date() },
        });
      }

      const detailRows = classified.filter((item) => item.kind === 'DETAIL').map((item) => item.row);
      const rowsByCoa = new Map<string, typeof detailRows>();
      for (const row of detailRows) {
        if (!row.coaCodeRaw) continue;
        rowsByCoa.set(row.coaCodeRaw, [...(rowsByCoa.get(row.coaCodeRaw) ?? []), row]);
      }

      const coaCodes = [...rowsByCoa.keys()];
      const coas = coaCodes.length
        ? await tx.costCoa.findMany({ where: { coaCode: { in: coaCodes } } })
        : [];
      const coaByCode = new Map(coas.map((coa) => [coa.coaCode, coa]));
      const coaIds = coas.map((coa) => coa.id);
      const effectiveMappings = coaIds.length
        ? await tx.costCoaMapping.findMany({
            where: {
              companyId: upload.period.companyId,
              sourceLogicalCode: source,
              coaId: { in: coaIds },
              active: true,
              validFrom: { lte: upload.period.periodStart },
              OR: [{ validTo: null }, { validTo: { gte: upload.period.periodStart } }],
            },
            include: { costGroup: true, nature: true },
          })
        : [];
      const mappingsByCoa = new Map<number, typeof effectiveMappings>();
      for (const mapping of effectiveMappings) {
        mappingsByCoa.set(mapping.coaId, [...(mappingsByCoa.get(mapping.coaId) ?? []), mapping]);
      }

      for (const [coaCode, coaRows] of rowsByCoa) {
        const coa = coaByCode.get(coaCode);
        const mappings = coa ? mappingsByCoa.get(coa.id) ?? [] : [];
        const context = `[${source}:${coaCode}]`;
        const rowIds = coaRows.map((row) => row.id);
        const firstRowId = rowIds[0];

        if (mappings.length === 1 && targetIsValid(mappings[0], upload.period.companyId)) {
          const mapping = mappings[0];
          const status = mapping.mappingAction === 'INCLUDE'
            ? 'MAPPED'
            : mapping.mappingAction === 'EXCLUDE'
              ? 'EXCLUDED'
              : 'RECLASSIFIED';
          sourceRowMappings.push(...rowIds.map((id) => ({ id, coaId: coa?.id ?? null, mappingStatus: status })));
          setMappingIssue(desiredIssues, firstRowId, context, null);
          continue;
        }

        sourceRowMappings.push(...rowIds.map((id) => ({ id, coaId: coa?.id ?? null, mappingStatus: 'UNMAPPED' })));

        const totalAmount = coaRows.reduce((sum, row) => sum.add(row.amount ?? 0), new Prisma.Decimal(0));
        const isBlocking = isMappingBlockingAmount(totalAmount.toString());
        if (mappings.length > 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_AMBIGUOUS', 'ERROR', 'Lebih dari satu mapping efektif.');
        } else if (mappings.length === 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_TARGET_INVALID', 'ERROR', 'Target mapping tidak lagi aktif/valid atau bukan Nature MAPPED.');
        } else if (totalAmount.isZero()) {
          // Exact-zero COAs remain visible in source-row audit evidence but do not
          // represent an unresolved business decision and must not create an open issue.
          setMappingIssue(desiredIssues, firstRowId, context, null);
        } else {
          setMappingIssue(
            desiredIssues,
            firstRowId,
            context,
            'UNMAPPED_COA',
            isBlocking ? 'ERROR' : 'WARNING',
            isBlocking
              ? 'COA belum memiliki disposition eksplisit.'
              : 'COA belum memiliki disposition, tetapi total absolut <= Rp1 sehingga non-blocking (de minimis).'
          );
        }
      }

      const message = sourcePolicy.fallbackUsed
        ? sourcePolicy.warningMessage
        : result.issueCode === 'CC_GROUP_TOTAL_NOT_FOUND'
          ? 'Reported total unik tidak ditemukan.'
          : result.issueCode === 'CC_GROUP_TOTAL_AMBIGUOUS'
            ? 'Lebih dari satu kandidat reported total ditemukan.'
            : result.issueCode
              ? `Detail ${result.detailAmount} tidak sama dengan reported ${result.reportedAmount}; selisih ${result.difference}.`
              : null;
      setSourceIssue(
        desiredIssues,
        source,
        sourcePolicy.fallbackUsed ? 'CC_GROUP_DEBIT_AUDIT_WARNING' : result.issueCode,
        message,
        sourcePolicy.fallbackUsed ? 'WARNING' : 'ERROR'
      );
    }

    await persistSourceRowMappings(tx, sourceRowMappings);
    await persistIssueBatch(tx, uploadId, desiredIssues);

    const supportRows = upload.sourceRows.filter(
      (row) => !required(upload.period.company.companyCode).includes(row.logicalSourceCode)
    );
    if (supportRows.length) {
      await tx.costSourceRow.updateMany({
        where: { id: { in: supportRows.map((row) => row.id) } },
        data: { mappingStatus: 'SUPPORT_SOURCE' },
      });
    }
    return results;
  }, reconciliationTransactionOptions);
}

export async function getPhaseDReport(uploadId: number) {
  const upload = await prisma.costUpload.findUnique({
    where: { id: uploadId },
    include: {
      period: { include: { company: true } },
      sourceRows: true,
      validationIssues: { orderBy: [{ resolved: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!upload) return null;

  const requiredSources = required(upload.period.company.companyCode);
  const historicalSupportEvidence = upload.period.company.companyCode === '2000'
    ? evaluateCompany2000HistoricalSupport(upload.sourceRows.map((row) => ({
        id: row.id,
        logicalSourceCode: row.logicalSourceCode,
        sourceRowNumber: row.sourceRowNumber,
        rawData: row.rawDataJson,
      })))
    : null;
  const sources = requiredSources.map((source) => {
    const rawResult = reconcileCcGroup(
      upload.sourceRows
        .filter((row) => row.logicalSourceCode === source)
        .map((row) => ({
          coaCodeRaw: row.coaCodeRaw,
          descriptionRaw: row.descriptionRaw,
          amount: row.amount?.toString() ?? null,
        }))
    );
    const sourcePolicy = applyCompany2000HistoricalSourcePolicy(
      upload.period.company.companyCode,
      source,
      rawResult,
      historicalSupportEvidence
    );
    return {
      logicalSourceCode: source,
      ...sourcePolicy.result,
      rawStatus: rawResult.status,
      controlMode: sourcePolicy.fallbackUsed ? 'RINCIAN_SI' : 'DEBIT',
    };
  });

  const detail = upload.sourceRows.filter(
    (row) =>
      requiredSources.includes(row.logicalSourceCode) &&
      classifySourceRow({
        coaCodeRaw: row.coaCodeRaw,
        descriptionRaw: row.descriptionRaw,
        amount: row.amount?.toString() ?? null,
      }).kind === 'DETAIL'
  );

  const completeness = calculateMappingCompleteness(detail.map((row) => ({
    logicalSourceCode: row.logicalSourceCode,
    coaCodeRaw: row.coaCodeRaw,
    amount: row.amount?.toString() ?? null,
    mappingStatus: row.mappingStatus,
  })));

  const structuralErrors = upload.validationIssues.filter(
    (issue) => !issue.resolved && issue.severity === 'ERROR' && !phaseDCodes.includes(issue.issueCode)
  );
  const mappingErrors = upload.validationIssues.filter(
    (issue) => !issue.resolved && issue.severity === 'ERROR' && mappingBlockingCodes.has(issue.issueCode)
  );

  const blockers = [
    ...sources.filter((source) => source.status !== 'RECONCILED').map((source) => `${source.logicalSourceCode}: ${source.status}`),
    ...(completeness.unmappedCoaCount ? [`${completeness.unmappedCoaCount} COA material belum memiliki disposition.`] : []),
    ...(completeness.blockingDifference !== '0.00' ? [`Mapping completeness material difference ${completeness.blockingDifference}.`] : []),
    ...mappingErrors.map((issue) => issue.message),
    ...structuralErrors.map((issue) => issue.message),
  ];

  return {
    upload,
    sources,
    completeness,
    blockers,
    ready: upload.isActiveVersion && blockers.length === 0,
  };
}

export async function refreshPeriodReadiness(uploadId: number) {
  const report = await getPhaseDReport(uploadId);
  if (!report) throw new Error('Upload tidak ditemukan.');
  if (report.upload.period.status === 'FINALIZED') throw new Error('Periode FINALIZED tidak dapat diubah.');

  const currentStatus = report.upload.period.status;
  const preserveHigherReadyState = report.ready && ['CALCULATED', 'COST_STRUCTURE_RECONCILED'].includes(currentStatus);
  const nextStatus = report.ready
    ? preserveHigherReadyState ? currentStatus : 'SOURCE_RECONCILED'
    : 'SOURCE_VALIDATION';

  await prisma.costPeriod.update({
    where: { id: report.upload.periodId },
    data: { status: nextStatus },
  });
  return report;
}
