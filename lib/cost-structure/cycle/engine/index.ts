import {
  FIXED_CYCLE_CODE,
  VARIABLE_CYCLE_CODE,
  type CycleCcMaster,
  type CycleDeltaRow,
  type CycleReceiverBaseline,
  type CycleReferenceConfig,
  type CycleReferenceSource,
  type CycleResolvedAction,
  type CycleSourceRow,
  type CycleTargetChange,
  type CycleValidationIssue,
} from '../contracts';
import { cycleIssue, hasBlockingCycleIssues } from '../validation/issues';

export type CycleSourceIndex = {
  rows: readonly CycleSourceRow[];
  byReceiverCc: ReadonlyMap<string, readonly CycleSourceRow[]>;
  byKey: ReadonlyMap<string, CycleSourceRow>;
  issues: readonly CycleValidationIssue[];
};

export type CycleReferenceResolution = {
  referenceCc?: string;
  referenceSource?: CycleReferenceSource;
  config?: CycleReferenceConfig;
  issues: readonly CycleValidationIssue[];
};

export type CyclePlannedAction = CycleResolvedAction & {
  referenceReviewStatus?: CycleReferenceConfig['reviewStatus'];
  referenceConfidence?: CycleReferenceConfig['confidence'];
};

export type CycleChangePlan = {
  actions: readonly CyclePlannedAction[];
  issues: readonly CycleValidationIssue[];
};

export type CycleDeltaSplit = {
  fixed: readonly CycleDeltaRow[];
  variable: readonly CycleDeltaRow[];
};

export type CycleEngineResult = {
  baselines: readonly CycleReceiverBaseline[];
  requestedChanges: readonly CycleTargetChange[];
  actions: readonly CyclePlannedAction[];
  issues: readonly CycleValidationIssue[];
  fixedAffectedRowCount: number;
  variableAffectedRowCount: number;
  delta: readonly CycleDeltaRow[];
  deltaByCycle: CycleDeltaSplit;
  generationBlocked: boolean;
};

const rowKey = (receiverCc: string, cycle: string, segmentName: string) =>
  `${receiverCc}\u0000${cycle}\u0000${segmentName}`;

function orderedRows(rows: readonly CycleSourceRow[]): CycleSourceRow[] {
  return rows.map((row) => ({ ...row, raw: row.raw ? { ...row.raw } : undefined }))
    .sort((a, b) => a.sourceOrder - b.sourceOrder || a.sourceRowNumber - b.sourceRowNumber);
}

export function indexSourceRows(rows: readonly CycleSourceRow[]): CycleSourceIndex {
  const ordered = orderedRows(rows);
  const grouped = new Map<string, CycleSourceRow[]>();
  const byKey = new Map<string, CycleSourceRow>();
  const issues: CycleValidationIssue[] = [];

  for (const row of ordered) {
    const receiverRows = grouped.get(row.receiverCc) ?? [];
    receiverRows.push(row);
    grouped.set(row.receiverCc, receiverRows);

    const key = rowKey(row.receiverCc, row.cycle, row.segmentName);
    const existing = byKey.get(key);
    if (existing) {
      issues.push(cycleIssue({
        code: 'DUPLICATE_TARGET_KEY',
        severity: 'ERROR',
        message: `Duplicate Cycle + Segment + Receiver CC key for ${row.receiverCc}.`,
        receiverCc: row.receiverCc,
        cycle: row.cycle,
        segmentName: row.segmentName,
        sourceRowNumber: row.sourceRowNumber,
        metadata: { firstSourceRowNumber: existing.sourceRowNumber },
      }));
    } else {
      byKey.set(key, row);
    }
    if (row.portion < 0) {
      issues.push(cycleIssue({
        code: 'NEGATIVE_PORTION', severity: 'WARNING',
        message: `Negative portion found for Receiver CC ${row.receiverCc}.`,
        receiverCc: row.receiverCc, cycle: row.cycle,
        segmentName: row.segmentName, sourceRowNumber: row.sourceRowNumber,
      }));
    }
  }

  return { rows: ordered, byReceiverCc: grouped, byKey, issues };
}

export function deriveReceiverBaselines(
  rows: readonly CycleSourceRow[],
  ccMaster: readonly CycleCcMaster[],
): CycleReceiverBaseline[] {
  const index = indexSourceRows(rows);
  return ccMaster
    .filter((master) => master.active && index.byReceiverCc.has(master.receiverCc))
    .map<CycleReceiverBaseline>((master) => {
      const receiverRows = index.byReceiverCc.get(master.receiverCc) ?? [];
      const fixed = receiverRows.filter((row) => row.cycle === FIXED_CYCLE_CODE);
      const variable = receiverRows.filter((row) => row.cycle === VARIABLE_CYCLE_CODE);
      const fixedNonZeroRowCount = fixed.filter((row) => row.portion !== 0).length;
      const variableNonZeroRowCount = variable.filter((row) => row.portion !== 0).length;
      return {
        receiverCc: master.receiverCc,
        plantCode: master.plantCode,
        plantName: master.plantName,
        processCode: master.processCode,
        processLabel: master.processLabel,
        displayOrder: master.displayOrder,
        fixedRowCount: fixed.length,
        variableRowCount: variable.length,
        fixedNonZeroRowCount,
        variableNonZeroRowCount,
        baselineStatus: fixedNonZeroRowCount + variableNonZeroRowCount > 0 ? 'ON' : 'OFF',
      };
    })
    .sort((a, b) => a.plantCode.localeCompare(b.plantCode) || a.displayOrder - b.displayOrder || a.receiverCc.localeCompare(b.receiverCc));
}

export function resolveReference(
  targetCc: string,
  referenceConfigs: readonly CycleReferenceConfig[],
  baselines: readonly CycleReceiverBaseline[],
  optionalUserSelectedReference?: string,
  isCandidateUsable: (referenceCc: string) => boolean = () => true,
): CycleReferenceResolution {
  const config = referenceConfigs.find((item) => item.receiverCc === targetCc && item.active);
  if (!config && !optionalUserSelectedReference) {
    return { issues: [cycleIssue({ code: 'REFERENCE_NOT_CONFIGURED', severity: 'ERROR', message: `No active reference is configured for ${targetCc}.`, receiverCc: targetCc })] };
  }
  if (config?.reviewStatus === 'MANUAL_REQUIRED' && !optionalUserSelectedReference) {
    return { config, issues: [cycleIssue({ code: 'REFERENCE_NOT_CONFIGURED', severity: 'ERROR', message: `Receiver CC ${targetCc} requires a manually selected reference.`, receiverCc: targetCc, metadata: { reviewStatus: config.reviewStatus } })] };
  }

  const candidates: Array<{ cc: string; source: CycleReferenceSource }> = optionalUserSelectedReference
    ? [{ cc: optionalUserSelectedReference, source: 'USER_SELECTED' }]
    : [
        ...(config?.preferredReferenceCc ? [{ cc: config.preferredReferenceCc, source: 'PREFERRED' as const }] : []),
        ...(config?.fallbackReferenceCcs ?? []).slice(0, 2).map((cc, index) => ({ cc, source: `FALLBACK_${index + 1}` as CycleReferenceSource })),
      ];
  let finalCode: 'REFERENCE_NOT_IN_UPLOAD' | 'REFERENCE_NOT_ACTIVE' | 'REFERENCE_SELF' | 'REFERENCE_NOT_CONFIGURED' | 'REFERENCE_SEGMENT_MISSING' = 'REFERENCE_NOT_CONFIGURED';
  for (const candidate of candidates) {
    if (candidate.cc === targetCc) { finalCode = 'REFERENCE_SELF'; continue; }
    const baseline = baselines.find((item) => item.receiverCc === candidate.cc);
    if (!baseline) { finalCode = 'REFERENCE_NOT_IN_UPLOAD'; continue; }
    if (baseline.baselineStatus !== 'ON') { finalCode = 'REFERENCE_NOT_ACTIVE'; continue; }
    if (!isCandidateUsable(candidate.cc)) { finalCode = 'REFERENCE_SEGMENT_MISSING'; continue; }
    const issues: CycleValidationIssue[] = [];
    if (candidate.source.startsWith('FALLBACK')) {
      issues.push(cycleIssue({ code: 'REFERENCE_FALLBACK_USED', severity: 'WARNING', message: `Fallback reference ${candidate.cc} is used for ${targetCc}.`, receiverCc: targetCc, metadata: { referenceCc: candidate.cc, referenceSource: candidate.source } }));
    }
    if (config?.reviewStatus === 'PROPOSED') {
      issues.push(cycleIssue({ code: 'REFERENCE_MAPPING_PROPOSED', severity: 'WARNING', message: `Reference mapping for ${targetCc} remains PROPOSED.`, receiverCc: targetCc, metadata: { referenceCc: candidate.cc, reviewStatus: config.reviewStatus, confidence: config.confidence } }));
    }
    return { referenceCc: candidate.cc, referenceSource: candidate.source, config, issues };
  }
  return { config, issues: [cycleIssue({ code: finalCode, severity: 'ERROR', message: `No usable reference is available for ${targetCc}.`, receiverCc: targetCc })] };
}

export function planCycleChanges(
  rows: readonly CycleSourceRow[],
  baselines: readonly CycleReceiverBaseline[],
  targetRequests: readonly CycleTargetChange[],
  referenceConfigs: readonly CycleReferenceConfig[],
): CycleChangePlan {
  const index = indexSourceRows(rows);
  const actions: CyclePlannedAction[] = [];
  const issues: CycleValidationIssue[] = [...index.issues];
  for (const request of targetRequests) {
    const baseline = baselines.find((item) => item.receiverCc === request.receiverCc);
    if (!baseline) {
      issues.push(cycleIssue({ code: 'UNMAPPED_RECEIVER_CC', severity: 'ERROR', message: `Receiver CC ${request.receiverCc} has no uploaded baseline.`, receiverCc: request.receiverCc }));
      continue;
    }
    const receiverRows = index.byReceiverCc.get(request.receiverCc) ?? [];
    const action = baseline.baselineStatus === request.targetStatus ? 'NO_CHANGE' : request.targetStatus === 'OFF' ? 'TURN_OFF' : 'TURN_ON';
    const resolved = action === 'TURN_ON'
      ? resolveReference(
          request.receiverCc,
          referenceConfigs,
          baselines,
          request.selectedReferenceCc,
          (candidateCc) => receiverRows.every((row) => index.byKey.has(rowKey(candidateCc, row.cycle, row.segmentName))),
        )
      : { issues: [] };
    issues.push(...resolved.issues);
    actions.push({
      receiverCc: request.receiverCc, baselineStatus: baseline.baselineStatus,
      targetStatus: request.targetStatus, action,
      referenceCc: resolved.referenceCc, referenceSource: resolved.referenceSource,
      referenceReviewStatus: resolved.config?.reviewStatus,
      referenceConfidence: resolved.config?.confidence,
      fixedAffectedRows: action === 'NO_CHANGE' ? 0 : receiverRows.filter((row) => row.cycle === FIXED_CYCLE_CODE).length,
      variableAffectedRows: action === 'NO_CHANGE' ? 0 : receiverRows.filter((row) => row.cycle === VARIABLE_CYCLE_CODE).length,
    });
  }
  return { actions, issues };
}

export function validatePlannedChanges(
  rows: readonly CycleSourceRow[],
  actions: readonly CycleResolvedAction[],
): CycleValidationIssue[] {
  const index = indexSourceRows(rows);
  const issues: CycleValidationIssue[] = [...index.issues];
  for (const action of actions) {
    if (action.action !== 'TURN_ON' || !action.referenceCc) continue;
    const targetRows = index.byReceiverCc.get(action.receiverCc) ?? [];
    const referenceRows = index.byReceiverCc.get(action.referenceCc) ?? [];
    const targetPairs = new Set(targetRows.map((row) => `${row.cycle}\u0000${row.segmentName}`));
    for (const target of targetRows) {
      if (!index.byKey.has(rowKey(action.referenceCc, target.cycle, target.segmentName))) {
        issues.push(cycleIssue({ code: 'REFERENCE_SEGMENT_MISSING', severity: 'ERROR', message: `Reference ${action.referenceCc} lacks a target Cycle + Segment.`, receiverCc: action.receiverCc, cycle: target.cycle, segmentName: target.segmentName, sourceRowNumber: target.sourceRowNumber, metadata: { referenceCc: action.referenceCc } }));
      }
    }
    for (const reference of referenceRows) {
      if (!targetPairs.has(`${reference.cycle}\u0000${reference.segmentName}`)) {
        issues.push(cycleIssue({ code: 'REFERENCE_EXTRA_SEGMENT', severity: 'WARNING', message: `Reference ${action.referenceCc} has a Cycle + Segment absent from target.`, receiverCc: action.receiverCc, cycle: reference.cycle, segmentName: reference.segmentName, sourceRowNumber: reference.sourceRowNumber, metadata: { referenceCc: action.referenceCc } }));
      }
    }
  }
  return issues;
}

export function buildCycleDelta(
  rows: readonly CycleSourceRow[],
  actions: readonly CycleResolvedAction[],
): CycleDeltaRow[] {
  const index = indexSourceRows(rows);
  const output: CycleDeltaRow[] = [];
  for (const action of actions) {
    if (action.action === 'NO_CHANGE' || (action.action === 'TURN_ON' && !action.referenceCc)) continue;
    for (const target of index.byReceiverCc.get(action.receiverCc) ?? []) {
      const reference = action.action === 'TURN_ON'
        ? index.byKey.get(rowKey(action.referenceCc!, target.cycle, target.segmentName))
        : undefined;
      if (action.action === 'TURN_ON' && !reference) continue;
      output.push({ cycle: target.cycle, startDate: target.startDate, segmentName: target.segmentName, receiverCc: target.receiverCc, portion: action.action === 'TURN_OFF' ? 0 : reference!.portion, sourceOrder: target.sourceOrder });
    }
  }
  return output.sort((a, b) => a.sourceOrder - b.sourceOrder);
}

export function splitDeltaByCycle(delta: readonly CycleDeltaRow[]): CycleDeltaSplit {
  return {
    fixed: delta.filter((row) => row.cycle === FIXED_CYCLE_CODE).map((row) => ({ ...row })),
    variable: delta.filter((row) => row.cycle === VARIABLE_CYCLE_CODE).map((row) => ({ ...row })),
  };
}

export function runCycleEngine(
  rows: readonly CycleSourceRow[], ccMaster: readonly CycleCcMaster[],
  targetRequests: readonly CycleTargetChange[], referenceConfigs: readonly CycleReferenceConfig[],
): CycleEngineResult {
  const baselines = deriveReceiverBaselines(rows, ccMaster);
  const plan = planCycleChanges(rows, baselines, targetRequests, referenceConfigs);
  const validationIssues = validatePlannedChanges(rows, plan.actions);
  // Source-level issues are already emitted by planning; avoid duplicating them from validation.
  const issues = [...plan.issues, ...validationIssues.filter((issue) => !['DUPLICATE_TARGET_KEY', 'NEGATIVE_PORTION'].includes(issue.code))];
  const generationBlocked = hasBlockingCycleIssues(issues);
  const delta = generationBlocked ? [] : buildCycleDelta(rows, plan.actions);
  const deltaByCycle = splitDeltaByCycle(delta);
  return {
    baselines, requestedChanges: targetRequests.map((request) => ({ ...request })), actions: plan.actions,
    issues, fixedAffectedRowCount: deltaByCycle.fixed.length,
    variableAffectedRowCount: deltaByCycle.variable.length, delta, deltaByCycle, generationBlocked,
  };
}
