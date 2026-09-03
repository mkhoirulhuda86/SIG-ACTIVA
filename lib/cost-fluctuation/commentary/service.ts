import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ComparisonType } from '../analysis/types';
import { boundedText, positiveSafeInteger } from '../validation';
import { resolveCommentaryTarget } from './context';
import { assertCurrentLineage } from './lineage';
import { nextStatus, WORKFLOW_AUDIT } from './workflow';
import { attachSuggestions, generateCommentary } from './generator';

const auditJson = (value: unknown) => value as Prisma.InputJsonValue;
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export async function getCommentaryOverlay(periodId: number, comparisonType: ComparisonType) {
  positiveSafeInteger(periodId, 'periodId');
  const { getMateriality } = await import('../materiality/service');
  const materiality = await getMateriality(periodId, comparisonType);
  if (materiality.kind !== 'OK' || materiality.status !== 'AVAILABLE') return materiality;
  const key = (await import('./context')).lineageKey(comparisonType, materiality.current.periods, materiality.comparison.periods);
  const rows = await prisma.costCommentary.findMany({
    where: { periodId, comparisonType, analysisLineageKey: key },
    include: { preparedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } }, history: { orderBy: { version: 'asc' } } },
    orderBy: { analysisKey: 'asc' },
  });
  return { ...materiality, hierarchy: attachSuggestions(materiality.hierarchy, comparisonType, materiality.comparisonLabel, key), analysisLineageKey: key, commentaries: rows };
}

export interface SaveDraftInput { periodId: number; comparisonType: ComparisonType; analysisKey: string; reason?: unknown }
export async function saveDraft(input: SaveDraftInput, userId: number) {
  positiveSafeInteger(input.periodId, 'periodId'); positiveSafeInteger(userId, 'userId');
  if (typeof input.analysisKey !== 'string' || !input.analysisKey.trim()) throw new Error('analysisKey is required.');
  const context = await resolveCommentaryTarget(input.periodId, input.comparisonType, input.analysisKey);
  const reason = boundedText(input.reason, 'reason', true);
  return prisma.$transaction(async (tx) => {
    await assertCurrentLineage(tx, input.comparisonType, context.analysis.current.periods, context.analysis.comparison.periods, context.analysisLineageKey);
    const identity = { periodId: input.periodId, comparisonType: input.comparisonType, analysisKey: context.target.node.key, analysisLineageKey: context.analysisLineageKey };
    const existing = await tx.costCommentary.findUnique({ where: { periodId_comparisonType_analysisKey_analysisLineageKey: identity }, include: { history: { orderBy: { version: 'desc' }, take: 1 } } });
    const status = nextStatus(existing?.status ?? null, 'SAVE', reason, '', existing?.preparedById ?? userId, userId);
    const data = { reason, status, preparedById: userId, preparedAt: new Date(), submittedAt: null, reviewerNote: null, reviewedById: null, reviewedAt: null };
    const generated = generateCommentary(context.target.node, input.comparisonType, context.analysis.comparisonLabel, context.analysisLineageKey);
    const generatedBaseline = generated && !existing?.generatedText
      ? { generatedText: generated.text, generationMetadataJson: auditJson(generated.metadata), generatedAt: new Date() }
      : {};
    const row = existing
      ? await tx.costCommentary.update({ where: { id: existing.id }, data: { ...data, ...generatedBaseline } })
      : await tx.costCommentary.create({ data: { ...data, ...identity, analysisLevel: context.analysisLevel, costGroupId: context.target.groupId, natureId: context.target.natureId, coaId: context.coaId, calculatedItemKey: context.calculatedItemKey,
        generatedText: generated?.text ?? null, generationMetadataJson: generated ? auditJson(generated.metadata) : Prisma.JsonNull, generatedAt: generated ? new Date() : null } });
    const version = (existing?.history[0]?.version ?? 0) + 1;
    await tx.costCommentaryHistory.create({ data: { commentaryId: row.id, version, reason, status, changedById: userId } });
    await tx.costAuditLog.create({ data: { userId, periodId: input.periodId, action: WORKFLOW_AUDIT.SAVE, entityType: 'CostCommentary', entityId: String(row.id), newValueJson: auditJson({ analysisKey: row.analysisKey, analysisLevel: row.analysisLevel, comparisonType: row.comparisonType, status: row.status, version, approvalRequired: false, generatedBaselineCaptured: Boolean(generated && !existing?.generatedText) }) } });
    return row;
  }, transactionOptions);
}

async function transition(id: number, userId: number, action: 'submit' | 'return' | 'review', note?: unknown) {
  positiveSafeInteger(id, 'commentaryId'); positiveSafeInteger(userId, 'userId');
  const row = await prisma.costCommentary.findUnique({ where: { id } });
  if (!row) throw new Error('Commentary not found.');
  const context = await resolveCommentaryTarget(row.periodId, row.comparisonType, row.analysisKey);
  const workflowAction = action.toUpperCase() as 'SUBMIT' | 'RETURN' | 'REVIEW';
  const reviewerNote = action === 'return' ? boundedText(note, 'reviewerNote', true) : boundedText(note, 'reviewerNote');
  return prisma.$transaction(async (tx) => {
    await assertCurrentLineage(tx, row.comparisonType, context.analysis.current.periods, context.analysis.comparison.periods, row.analysisLineageKey);
    const current = await tx.costCommentary.findUniqueOrThrow({ where: { id }, include: { history: { orderBy: { version: 'desc' }, take: 1 } } });
    if (current.analysisLineageKey !== context.analysisLineageKey) throw new Error('Commentary changed concurrently or is stale.');
    const status = nextStatus(current.status, workflowAction, current.reason, reviewerNote, current.preparedById, userId);
    const data = action === 'submit'
      ? { status, submittedAt: new Date() }
      : action === 'return' ? { status, reviewerNote }
        : { status, reviewerNote: reviewerNote || null, reviewedById: userId, reviewedAt: new Date() };
    const updated = await tx.costCommentary.update({ where: { id }, data });
    const version = (current.history[0]?.version ?? 0) + 1;
    await tx.costCommentaryHistory.create({ data: { commentaryId: id, version, reason: updated.reason, status: updated.status, reviewerNote: updated.reviewerNote, changedById: userId } });
    await tx.costAuditLog.create({ data: { userId, periodId: row.periodId, action: WORKFLOW_AUDIT[workflowAction], entityType: 'CostCommentary', entityId: String(id), newValueJson: auditJson({ status: updated.status, version }) } });
    return updated;
  }, transactionOptions);
}

// Legacy endpoints are retained for audit/backward compatibility. Current product UI uses SAVE only.
export const submitCommentary = (id: number, userId: number) => transition(id, userId, 'submit');
export const returnCommentary = (id: number, userId: number, note: unknown) => transition(id, userId, 'return', note);
export const reviewCommentary = (id: number, userId: number, note?: unknown) => transition(id, userId, 'review', note);
