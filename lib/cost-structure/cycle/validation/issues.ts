import type { CycleValidationIssue } from '../contracts';

export function hasBlockingCycleIssues(issues: readonly CycleValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'ERROR');
}

export function cycleIssue(
  issue: CycleValidationIssue,
): CycleValidationIssue {
  return {
    ...issue,
    metadata: issue.metadata ? { ...issue.metadata } : undefined,
  };
}
