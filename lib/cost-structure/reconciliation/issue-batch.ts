export const SOURCE_CONTROL_CODES = ['CC_GROUP_TOTAL_NOT_FOUND', 'CC_GROUP_TOTAL_AMBIGUOUS', 'CC_GROUP_NOT_RECONCILED', 'CC_GROUP_DEBIT_AUDIT_WARNING'] as const;
export const MAPPING_ISSUE_CODES = ['UNMAPPED_COA', 'MAPPING_AMBIGUOUS', 'MAPPING_OVERLAP', 'MAPPING_TARGET_INVALID'] as const;

export type IssueSeverity = 'ERROR' | 'WARNING';

export type UnresolvedPhaseDIssue = {
  id: number;
  sourceRowId: number | null;
  issueCode: string;
  severity: string;
  message: string;
};

type DesiredIssue = {
  sourceRowId: number | null;
  issueCode: string | null;
  severity: IssueSeverity;
  message: string | null;
  resolutionType: 'CONTROL_RERUN_RESOLVED' | 'MAPPING_RERUN_RESOLVED';
  updateMetadata: boolean;
};

export type IssueBatch = {
  resolve: Map<'CONTROL_RERUN_RESOLVED' | 'MAPPING_RERUN_RESOLVED', number[]>;
  create: Array<{ uploadId: number; sourceRowId: number | null; issueCode: string; severity: IssueSeverity; message: string }>;
  update: Array<{ id: number; sourceRowId: number | null; severity: IssueSeverity; message: string }>;
};

function issueContext(message: string) {
  const end = message.indexOf(']');
  return message.startsWith('[') && end >= 0 ? message.slice(0, end + 1) : null;
}

/**
 * Reproduces the old per-context issue synchronization in memory. In particular,
 * only a different issue code is resolved; duplicate issues with the desired code
 * remain unresolved just as they did before batching.
 */
export function buildIssueBatch(
  uploadId: number,
  existing: UnresolvedPhaseDIssue[],
  desiredByContext: Map<string, DesiredIssue>
): IssueBatch {
  const existingByContext = new Map<string, UnresolvedPhaseDIssue[]>();
  for (const issue of existing) {
    const context = issueContext(issue.message);
    if (!context) continue;
    existingByContext.set(context, [...(existingByContext.get(context) ?? []), issue]);
  }

  const batch: IssueBatch = {
    resolve: new Map([
      ['CONTROL_RERUN_RESOLVED', []],
      ['MAPPING_RERUN_RESOLVED', []],
    ]),
    create: [],
    update: [],
  };

  for (const [context, desired] of desiredByContext) {
    const current = existingByContext.get(context) ?? [];
    for (const issue of current) {
      if (issue.issueCode !== desired.issueCode) batch.resolve.get(desired.resolutionType)!.push(issue.id);
    }
    if (!desired.issueCode || !desired.message) continue;

    const same = current.find((issue) => issue.issueCode === desired.issueCode);
    if (!same) {
      batch.create.push({
        uploadId,
        sourceRowId: desired.sourceRowId,
        issueCode: desired.issueCode,
        severity: desired.severity,
        message: desired.message,
      });
    } else if (same.message !== desired.message || (desired.updateMetadata && (
      same.sourceRowId !== desired.sourceRowId || same.severity !== desired.severity
    ))) {
      batch.update.push({
        id: same.id,
        sourceRowId: desired.updateMetadata ? desired.sourceRowId : same.sourceRowId,
        severity: desired.updateMetadata ? desired.severity : same.severity as IssueSeverity,
        message: desired.message,
      });
    }
  }

  return batch;
}

export type DesiredIssueMap = Map<string, DesiredIssue>;
