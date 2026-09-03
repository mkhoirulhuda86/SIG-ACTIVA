export const PROCESS_STAGE_KEYS = [
  'UPLOAD',
  'SOURCE_VALIDATION',
  'RECONCILIATION',
  'AUDIT_READINESS',
  'CALCULATION',
  'POST_CHECK',
] as const;

export type ProcessStageKey = (typeof PROCESS_STAGE_KEYS)[number];
export type ProcessStageStatus = 'COMPLETED' | 'RUNNING' | 'WAITING' | 'BLOCKED' | 'NOT_APPLICABLE';
export type ProcessOverallStatus = 'PROCESSING' | 'BLOCKED' | 'READY' | 'FINALIZED';

export type ProcessBlocker = string | { code?: string; message?: string; action?: string };

export interface ProcessStage {
  key: ProcessStageKey;
  status: ProcessStageStatus;
  title: string;
  message?: string;
  errorCode?: string;
  blockers?: ProcessBlocker[];
}

export interface CostStructureProcess {
  uploadId: number;
  periodId: number;
  overallStatus: ProcessOverallStatus;
  currentStage: ProcessStageKey | null;
  stages: ProcessStage[];
  canAdvance: boolean;
  canRetry: boolean;
  requiresRecalculation: boolean;
  readyForFinalization: boolean;
}
