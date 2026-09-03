import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ComparisonType, Lineage } from '../analysis/types';
import { boundedText, positiveSafeInteger } from '../validation';
import { getCommentaryOverlay } from '../commentary/service';
import { assertCurrentLineage } from '../commentary/lineage';
import { evaluateNode, resolveRule } from '../materiality/evaluate';
import type { MaterialityNode, MaterialityRuleValue } from '../materiality/types';
import { readiness, scopeReviewNodes } from './readiness';

const TYPES: ComparisonType[] = ['MOM', 'YOY', 'YTD'];
type Available = { comparisonType: ComparisonType; current: { periods: Lineage[] }; comparison: { periods: Lineage[] }; analysisLineageKey: string; hierarchy: MaterialityNode[] };

async function preview(periodId: number) {
  const period = await prisma.costPeriod.findUnique({ where: { id: periodId }, include: { fluctuationReview: true } });
  if (!period) throw new Error('Period not found.');
  const analyses = await Promise.all(TYPES.map(async (comparisonType) => ({ comparisonType, overlay: await getCommentaryOverlay(periodId, comparisonType) })));
  const available: Available[] = [];
  const readinessInput: Array<{ available: boolean; rows: Array<{ key: string; nodeType: string; materialityStatus: string; commentaryStatus?: string }> }> = [];

  for (const { comparisonType, overlay } of analyses) {
    if (overlay.kind !== 'OK' || overlay.status !== 'AVAILABLE') {
      readinessInput.push({ available: false, rows: [] });
      continue;
    }
    available.push({ comparisonType, current: overlay.current, comparison: overlay.comparison, analysisLineageKey: overlay.analysisLineageKey, hierarchy: overlay.hierarchy });
    const scoped = scopeReviewNodes(overlay.hierarchy);
    const commentary = new Map(overlay.commentaries.map((row) => [row.analysisKey, row]));
    readinessInput.push({
      available: true,
      rows: scoped
        .filter(({ node }) => node.nodeType !== 'COMPANY' && node.nodeType !== 'ANALYSIS_BASIS')
        .map(({ node }) => ({ key: `${comparisonType}:${node.key}`, nodeType: node.nodeType, materialityStatus: node.materialityStatus, commentaryStatus: commentary.get(node.key)?.status })),
    });
  }

  const evaluated = readiness(period.status, readinessInput);
  return { period, available, blockers: evaluated.blockers, ready: evaluated.ready };
}

export async function reviewReadiness(periodId: number) {
  positiveSafeInteger(periodId, 'periodId');
  const result = await preview(periodId);
  return { periodId, periodStatus: result.period.status, review: result.period.fluctuationReview, availableComparisons: result.available.length, blockers: result.blockers, ready: result.ready };
}

async function assertReadyAtCommit(tx: Prisma.TransactionClient, periodId: number, initial: Awaited<ReturnType<typeof preview>>) {
  const locked = await tx.$queryRaw<Array<{ status: string; companyId: number; periodEnd: Date }>>(Prisma.sql`SELECT status::text, "companyId", "periodEnd" FROM cost_periods WHERE id=${periodId} FOR UPDATE`);
  if (locked[0]?.status !== 'FINALIZED') throw new Error('Cost Period must remain FINALIZED.');

  for (const analysis of initial.available) {
    await assertCurrentLineage(tx, analysis.comparisonType, analysis.current.periods, analysis.comparison.periods, analysis.analysisLineageKey);
  }

  for (const analysis of initial.available) {
    const scoped = scopeReviewNodes(analysis.hierarchy);
    const groupIds = [...new Set(scoped.filter(({ node }) => node.nodeType === 'COST_GROUP').map(({ node }) => node.id).filter((id): id is number => id !== null))];
    for (const groupId of groupIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cost-materiality:${locked[0].companyId}:${groupId}:${analysis.comparisonType}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cost-materiality:${locked[0].companyId}:all:${analysis.comparisonType}`}, 0))`;
    }

    const rules = await tx.costMaterialityRule.findMany({
      where: {
        companyId: locked[0].companyId,
        comparisonType: analysis.comparisonType,
        active: true,
        validFrom: { lte: locked[0].periodEnd },
        OR: [{ validTo: null }, { validTo: { gte: locked[0].periodEnd } }],
      },
    }) as unknown as MaterialityRuleValue[];

    const required = new Set<string>();
    for (const { node, groupId } of scoped) {
      if (node.nodeType === 'COMPANY' || node.nodeType === 'ANALYSIS_BASIS') continue;
      if (groupId === null) throw new Error('Invalid analytical hierarchy.');
      const evaluated = evaluateNode(node, resolveRule(rules, locked[0].companyId, groupId, analysis.comparisonType, locked[0].periodEnd));
      if (['NOT_CONFIGURED', 'NOT_EVALUABLE'].includes(evaluated.materialityStatus)) throw new Error(`${analysis.comparisonType}: materiality is incomplete at commit.`);
      if (node.nodeType === 'NATURE' && evaluated.materialityStatus === 'REQUIRES_EXPLANATION') required.add(node.key);
    }

    const requiredKeys = [...required];
    const saved = requiredKeys.length ? await tx.costCommentary.findMany({
      where: { periodId, comparisonType: analysis.comparisonType, analysisLineageKey: analysis.analysisLineageKey, analysisKey: { in: requiredKeys } },
      select: { analysisKey: true, reason: true },
    }) : [];
    const savedKeys = new Set(saved.filter((row) => row.reason.trim()).map((row) => row.analysisKey));
    if (savedKeys.size !== requiredKeys.length) throw new Error(`${analysis.comparisonType}: mandatory Nature commentary changed before completion.`);
  }
}

export async function completePeriodReview(periodId: number, userId: number, note?: unknown) {
  positiveSafeInteger(periodId, 'periodId'); positiveSafeInteger(userId, 'userId');
  const cleanNote = boundedText(note, 'note') || null;
  const initial = await preview(periodId);
  if (!initial.ready) throw new Error(initial.blockers.join(' '));
  return prisma.$transaction(async (tx) => {
    await assertReadyAtCommit(tx, periodId, initial);
    const review = await tx.costPeriodReview.upsert({
      where: { periodId },
      create: { periodId, reviewStatus: 'COMPLETED', reviewedById: userId, reviewedAt: new Date(), note: cleanNote },
      update: { reviewStatus: 'COMPLETED', reviewedById: userId, reviewedAt: new Date(), note: cleanNote },
    });
    await tx.costAuditLog.create({ data: { userId, periodId, action: 'COMPLETE_FLUCTUATION_REVIEW', entityType: 'CostPeriodReview', entityId: String(review.id), newValueJson: { reviewStatus: review.reviewStatus, availableComparisons: initial.available.length } } });
    return review;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
