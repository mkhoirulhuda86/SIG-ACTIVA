import { createHash } from 'node:crypto';
import type { ComparedNode, ComparisonType, Lineage } from '../analysis/types';

const byLineage = (a: Lineage, b: Lineage) =>
  a.fiscalYear - b.fiscalYear ||
  a.fiscalPeriod - b.fiscalPeriod ||
  a.periodId - b.periodId ||
  a.basisCode.localeCompare(b.basisCode) ||
  a.runId - b.runId ||
  a.uploadId - b.uploadId ||
  a.ruleSetVersion.localeCompare(b.ruleSetVersion);

export function lineageKey(comparisonType: ComparisonType, current: Lineage[], comparison: Lineage[]) {
  const canonical = JSON.stringify({
    comparisonType,
    current: [...current].sort(byLineage),
    comparison: [...comparison].sort(byLineage),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

type CommentaryTarget = { node: ComparedNode; groupId: number | null; natureId: number | null };

export function locateCommentaryNode(
  nodes: ComparedNode[],
  key: string,
  parent: { groupId: number | null; natureId: number | null } = { groupId: null, natureId: null },
): CommentaryTarget | null {
  for (const node of nodes) {
    const next = {
      groupId: node.nodeType === 'COST_GROUP' ? node.id : parent.groupId,
      natureId: node.nodeType === 'NATURE' ? node.id : parent.natureId,
    };
    if (node.key === key) return { node, groupId: next.groupId, natureId: next.natureId };
    const found = node.children && locateCommentaryNode(node.children, key, next);
    if (found) return found;
  }
  return null;
}

export async function resolveCommentaryTarget(periodId: number, comparisonType: ComparisonType, analysisKey: string) {
  const { getCostFluctuationAnalysis } = await import('../analysis/service');
  const analysis = await getCostFluctuationAnalysis(periodId, comparisonType);
  if (analysis.kind !== 'OK' || analysis.status !== 'AVAILABLE') throw new Error('Comparison must be AVAILABLE for commentary.');
  const target = locateCommentaryNode(analysis.hierarchy, analysisKey);
  if (!target) throw new Error('Analysis target is not part of the current hierarchy.');
  const level = target.node.nodeType;
  if (level !== 'NATURE' && level !== 'COA') throw new Error(`${level} commentary is not applicable. Commentary hanya tersedia pada level Nature dan optional pada COA.`);
  if (target.groupId === null) throw new Error('Analysis target has no Cost Group context.');
  return {
    analysis,
    target: { ...target, groupId: target.groupId },
    analysisLineageKey: lineageKey(comparisonType, analysis.current.periods, analysis.comparison.periods),
    analysisLevel: level,
    coaId: level === 'COA' ? target.node.id : null,
    calculatedItemKey: null,
  };
}
