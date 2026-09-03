import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentEngine1RuleSetVersion } from '@/lib/cost-structure/calculations/rule-set';
import {
  assertFinalizationReady,
  assertReconciliationReady,
  FinalizationError,
  mappingCompleteForReadiness,
  type FinalizationSnapshot,
} from './policy';
export { assertFinalizationReady, assertPersistedControlsReady, assertReconciliationReady, FinalizationError } from './policy';

type SnapshotDb = Pick<Prisma.TransactionClient, 'costPeriod' | 'costCalculationResult' | 'costValidationIssue' | 'costSourceRow'>;

async function loadSnapshot(periodId: number, db: SnapshotDb = prisma): Promise<FinalizationSnapshot | null> {
  const period = await db.costPeriod.findUnique({
    where: { id: periodId },
    include: {
      company: { select: { companyCode: true } },
      activeCalculationRun: { select: { id: true, status: true, isActive: true, uploadId: true, ruleSetVersion: true, completedAt: true, upload: { select: { isActiveVersion: true } } } },
    },
  });
  if (!period) return null;
  const runId = period.activeCalculationRun?.id;
  const uploadId = period.activeCalculationRun?.uploadId;
  const [results, unresolvedErrors, mappingRows, reconciliationErrors] = await Promise.all([
    runId ? db.costCalculationResult.findMany({
      where: { calculationRunId: runId },
      select: { resultCode: true, resultType: true, reconciliationStatus: true, reconciliationDifference: true },
    }) : [],
    uploadId ? db.costValidationIssue.count({ where: { uploadId, severity: 'ERROR', resolved: false } }) : 0,
    uploadId ? db.costSourceRow.findMany({
      where: { uploadId, mappingStatus: { in: ['MAPPED', 'EXCLUDED', 'RECLASSIFIED', 'UNMAPPED'] } },
      select: { logicalSourceCode: true, coaCodeRaw: true, amount: true, mappingStatus: true },
    }) : [],
    uploadId ? db.costValidationIssue.count({
      where: { uploadId, issueCode: { in: ['CC_GROUP_NOT_RECONCILED', 'SOURCE_NOT_RECONCILED'] }, resolved: false },
    }) : 0,
  ]);
  const currentRuleSetVersion = getCurrentEngine1RuleSetVersion(period.company.companyCode);
const runRequiresRecalculation = Boolean(period.activeCalculationRun && (
  period.activeCalculationRun.ruleSetVersion !== currentRuleSetVersion ||
  (period.reopenedAt && (!period.activeCalculationRun.completedAt || period.activeCalculationRun.completedAt < period.reopenedAt))
));
return {
  companyCode: period.company.companyCode,
    periodStatus: period.status,
    run: period.activeCalculationRun ? {
      id: period.activeCalculationRun.id,
      status: period.activeCalculationRun.status,
      isActive: period.activeCalculationRun.isActive,
      uploadIsActiveVersion: period.activeCalculationRun.upload.isActiveVersion,
      requiresRecalculation: runRequiresRecalculation,
    } : null,
    unresolvedErrors,
    sourceReconciled: reconciliationErrors === 0,
    mappingComplete: mappingCompleteForReadiness(mappingRows.map((row) => ({
      logicalSourceCode: row.logicalSourceCode,
      coaCodeRaw: row.coaCodeRaw,
      amount: row.amount?.toString() ?? null,
      mappingStatus: row.mappingStatus,
    }))),
    results,
  };
}

export async function reconcileCostStructure(periodId: number, userId: number) {
  const snapshot = await loadSnapshot(periodId);
  if (!snapshot) throw new FinalizationError('Periode tidak ditemukan.');
  const runId = assertReconciliationReady(snapshot);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.costPeriod.updateMany({
      where: { id: periodId, status: 'CALCULATED', activeCalculationRunId: runId },
      data: { status: 'COST_STRUCTURE_RECONCILED' },
    });
    if (updated.count !== 1) throw new FinalizationError('Status atau active run berubah; muat ulang dan coba lagi.');
    await tx.costAuditLog.create({
      data: {
        userId,
        periodId,
        action: 'RECONCILE_COST_STRUCTURE',
        entityType: 'CostPeriod',
        entityId: String(periodId),
        oldValueJson: { status: 'CALCULATED' },
        newValueJson: { status: 'COST_STRUCTURE_RECONCILED', runId },
      },
    });
    return { status: 'COST_STRUCTURE_RECONCILED' as const, runId };
  });
}

export async function finalizeCostStructure(periodId: number, userId: number, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    // Re-read every persisted readiness condition inside the same transaction. A stale
    // COST_STRUCTURE_RECONCILED status alone is never sufficient for finalization.
    const snapshot = await loadSnapshot(periodId, tx);
    if (!snapshot) throw new FinalizationError('Periode tidak ditemukan.');
    const runId = assertFinalizationReady(snapshot);
    const updated = await tx.costPeriod.updateMany({
      where: { id: periodId, status: 'COST_STRUCTURE_RECONCILED', activeCalculationRunId: runId },
      data: {
        status: 'FINALIZED',
        finalizedAt: now,
        finalizedById: userId,
        reopenedAt: null,
        reopenedById: null,
        reopenReason: null,
      },
    });
    if (updated.count !== 1) throw new FinalizationError('Status atau active run berubah; finalization dibatalkan.');
    await tx.costAuditLog.create({
      data: {
        userId,
        periodId,
        action: 'FINALIZE_COST_STRUCTURE',
        entityType: 'CostPeriod',
        entityId: String(periodId),
        oldValueJson: { status: 'COST_STRUCTURE_RECONCILED', runId },
        newValueJson: { status: 'FINALIZED', finalizedAt: now.toISOString(), runId },
      },
    });
    return { status: 'FINALIZED' as const, finalizedAt: now, runId };
  });
}

export async function reopenCostStructure(periodId: number, userId: number, reason: string, now = new Date()) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new FinalizationError('Alasan reopen wajib diisi.');
  return prisma.$transaction(async (tx) => {
    const period = await tx.costPeriod.findUnique({
      where: { id: periodId },
      select: { status: true, activeCalculationRunId: true, activeCalculationRun: { select: { id: true, status: true, isActive: true } } },
    });
    if (!period || period.status !== 'FINALIZED') throw new FinalizationError('Hanya periode FINALIZED yang dapat dibuka kembali.');
    const nextStatus = period.activeCalculationRun?.status === 'SUCCESS' && period.activeCalculationRun.isActive ? 'CALCULATED' : 'SOURCE_RECONCILED';
    const updated = await tx.costPeriod.updateMany({
      where: { id: periodId, status: 'FINALIZED', activeCalculationRunId: period.activeCalculationRunId },
      data: {
        status: nextStatus,
        finalizedAt: null,
        finalizedById: null,
        reopenedAt: now,
        reopenedById: userId,
        reopenReason: normalizedReason,
      },
    });
    if (updated.count !== 1) throw new FinalizationError('Status periode berubah; reopen dibatalkan.');
    await tx.costAuditLog.create({
      data: {
        userId,
        periodId,
        action: 'REOPEN_COST_STRUCTURE',
        entityType: 'CostPeriod',
        entityId: String(periodId),
        oldValueJson: { status: 'FINALIZED' },
        newValueJson: { status: nextStatus, activeRunPreserved: true, activeCalculationRunId: period.activeCalculationRunId },
        reason: normalizedReason,
      },
    });
    return { status: nextStatus, reopenedAt: now };
  });
}
