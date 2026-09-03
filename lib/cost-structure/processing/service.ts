import 'server-only';
import { prisma } from '@/lib/prisma';
import { getAuditSnapshotReadiness } from '@/lib/cost-structure/audit-hydration/readiness';
import { reconcileCostStructure } from '@/lib/cost-structure/finalization/service';
import { backfillAuthoritativeBaselineMappings } from '@/lib/cost-structure/mappings/authoritative-baseline-backfill';
import { backfillDeterministicFamilyMappings } from '@/lib/cost-structure/mappings/family-mapping-backfill';
import { getPhaseDReport, refreshPeriodReadiness, runPhaseD } from '@/lib/cost-structure/reconciliation/service';
import { runAutomaticCostStructureCalculation } from './automatic-calculation';
import { revalidateCostUpload } from './revalidate-upload';
import { deriveProcessStatus, executeNextProcessStage, type CostStructureProcessStatus, type ProcessBlocker, type ProcessingSnapshot } from './state-machine';

export class CostStructureProcessNotFoundError extends Error {}

function issueBlocker(issue: { issueCode: string; message: string }): ProcessBlocker {
  return { code: issue.issueCode, message: issue.message };
}

export async function getCostStructureProcessStatus(uploadId: number): Promise<CostStructureProcessStatus> {
  const upload = await prisma.costUpload.findUnique({
    where: { id: uploadId },
    include: {
      period: { include: { company: { select: { companyCode: true } }, activeCalculationRun: { include: { results: { where: { resultType: 'CONTROL' }, select: { resultCode: true, reconciliationDifference: true, reconciliationStatus: true } } } } } },
      validationIssues: { where: { resolved: false, severity: 'ERROR' }, orderBy: { createdAt: 'asc' }, select: { issueCode: true, message: true } },
      sourceRows: { where: { mappingStatus: { notIn: ['UNMAPPED', 'AUDIT_ONLY'] } }, take: 1, select: { id: true } },
      calculationRuns: { orderBy: { runNumber: 'desc' }, take: 1, select: { uploadId: true, status: true, errorMessage: true } },
    },
  });
  if (!upload) throw new CostStructureProcessNotFoundError('Upload tidak ditemukan.');

  const report = await getPhaseDReport(uploadId);
  if (!report) throw new CostStructureProcessNotFoundError('Upload tidak ditemukan.');
  // Audit templates are reported for visibility only. They are export/downstream
  // audit inputs, not prerequisites for Engine-1 calculation.
  const audit = await getAuditSnapshotReadiness(uploadId, upload.period.company.companyCode);

  // SOURCE_ROW_MISSING_COA is intentionally allowed to enter Phase D because
  // control/total rows can be auto-classified there. It must not, by itself,
  // make us think Phase D has already run; otherwise the pre-run report would
  // block the very reconciliation that can resolve those control-row issues.
  const phaseDResolvableIssueCodes = new Set([
    'CC_GROUP_TOTAL_NOT_FOUND',
    'CC_GROUP_TOTAL_AMBIGUOUS',
    'CC_GROUP_NOT_RECONCILED',
    'SOURCE_ROW_MISSING_COA',
    'UNMAPPED_COA',
    'MAPPING_AMBIGUOUS',
    'MAPPING_OVERLAP',
    'MAPPING_TARGET_INVALID',
  ]);
  const phaseDProducedIssueCodes = new Set([
    'CC_GROUP_TOTAL_NOT_FOUND',
    'CC_GROUP_TOTAL_AMBIGUOUS',
    'CC_GROUP_NOT_RECONCILED',
    'UNMAPPED_COA',
    'MAPPING_AMBIGUOUS',
    'MAPPING_OVERLAP',
    'MAPPING_TARGET_INVALID',
  ]);
  const structuralIssues = upload.validationIssues.filter((issue) => !phaseDResolvableIssueCodes.has(issue.issueCode));
  const phaseDStarted = upload.sourceRows.length > 0 || upload.validationIssues.some((issue) => phaseDProducedIssueCodes.has(issue.issueCode));
  const activeRun = upload.period.activeCalculationRun;
  const postCheckBlockers = activeRun?.status === 'SUCCESS'
    ? activeRun.results.filter((control) => control.reconciliationStatus !== 'RECONCILED').map((control) => ({ code: control.resultCode, message: `${control.resultCode} belum reconciled (difference ${control.reconciliationDifference?.toString() ?? 'N/A'}).` }))
    : [];
  const latestRun = upload.calculationRuns[0] ?? null;
  const snapshot: ProcessingSnapshot = {
    uploadId,
    periodId: upload.periodId,
    uploadActive: upload.isActiveVersion,
    uploadStatus: upload.status,
    periodStatus: upload.period.status,
    validationBlockers: structuralIssues.map(issueBlocker),
    reconciliationReady: report.ready && ['SOURCE_RECONCILED', 'CALCULATED', 'COST_STRUCTURE_RECONCILED', 'FINALIZED'].includes(upload.period.status),
    reconciliationBlockers: phaseDStarted ? report.blockers.map((message) => ({ code: 'RECONCILIATION_BLOCKER', message })) : [],
    auditReady: audit.ready,
    auditMissing: audit.missing,
    calculation: activeRun ? { status: activeRun.status, errorMessage: activeRun.errorMessage, belongsToUpload: activeRun.uploadId === uploadId } : latestRun ? { status: latestRun.status, errorMessage: latestRun.errorMessage, belongsToUpload: latestRun.uploadId === uploadId } : null,
    postCheckBlockers,
  };
  return deriveProcessStatus(snapshot);
}

type AdvanceDependencies = {
  status(uploadId: number): Promise<CostStructureProcessStatus>;
  revalidate(uploadId: number, userId: number): Promise<void>;
  reconcile(uploadId: number, userId: number): Promise<void>;
  calculate(periodId: number, uploadId: number, userId: number): Promise<void>;
  postCheck(periodId: number, userId: number): Promise<void>;
};

const dependencies: AdvanceDependencies = {
  status: getCostStructureProcessStatus,
  revalidate: async (uploadId, userId) => { await revalidateCostUpload(uploadId, userId); },
  reconcile: async (uploadId, userId) => {
    // Exact authoritative COA mappings always outrank family inference.
    await backfillAuthoritativeBaselineMappings(uploadId, userId);
    // A new COA may inherit an existing four-digit family only when the family target
    // is unanimous. Ambiguous/new families remain explicit manual mapping work.
    await backfillDeterministicFamilyMappings(uploadId, userId);
    await runPhaseD(uploadId);
    await refreshPeriodReadiness(uploadId);
  },
  calculate: async (periodId, uploadId, userId) => { await runAutomaticCostStructureCalculation(periodId, uploadId, userId); },
  postCheck: async (periodId, userId) => { await reconcileCostStructure(periodId, userId); },
};

/** Executes at most one persisted Engine-1 stage. FINALIZE and audit hydration are deliberately absent. */
export async function advanceCostStructureProcess(uploadId: number, userId: number, deps: AdvanceDependencies = dependencies) {
  const before = await deps.status(uploadId);
  return executeNextProcessStage(before, {
    SOURCE_VALIDATION: () => deps.revalidate(uploadId, userId),
    RECONCILIATION: () => deps.reconcile(uploadId, userId),
    CALCULATION: () => deps.calculate(before.periodId, uploadId, userId),
    POST_CHECK: () => deps.postCheck(before.periodId, userId),
  }, () => deps.status(uploadId));
}
