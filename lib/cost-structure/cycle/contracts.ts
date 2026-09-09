export const FIXED_CYCLE_CODE = '7FT1GF' as const;
export const VARIABLE_CYCLE_CODE = '7VT1GF' as const;

export const SUPPORTED_CYCLE_CODES = [FIXED_CYCLE_CODE, VARIABLE_CYCLE_CODE] as const;
export type CycleCode = (typeof SUPPORTED_CYCLE_CODES)[number];
export type CycleKind = 'FIXED' | 'VARIABLE';
export type CycleStatus = 'ON' | 'OFF';
export type CycleAction = 'NO_CHANGE' | 'TURN_OFF' | 'TURN_ON';

export const CYCLE_OUTPUT_HEADERS = [
  'Cycle',
  'Start Date',
  'Segment name',
  'Receiver CC',
  'Portion/Percent',
] as const;

export const CYCLE_OUTPUT_SHEET_NAME = 'Lembar1' as const;

export const INDONESIAN_MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agt',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

export type CycleReferenceConfidence = 'Validated' | 'High' | 'Medium' | 'Manual';
export type CycleReferenceReviewStatus = 'VALIDATED' | 'PROPOSED' | 'MANUAL_REQUIRED';
export type CycleReferenceSource = 'PREFERRED' | 'FALLBACK_1' | 'FALLBACK_2' | 'USER_SELECTED';
export type CycleIssueSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type CycleSourceRow = {
  sourceRowNumber: number;
  sourceOrder: number;
  cycle: CycleCode;
  /** ISO calendar date normalized from the SAP Start Date cell. */
  startDate: string;
  /** Identifier, not a numeric business amount. */
  segmentName: string;
  /** Identifier, not a numeric business amount. */
  receiverCc: string;
  /** Allocation portion. No financial arithmetic is performed on this field. */
  portion: number;
  raw?: Record<string, unknown>;
};

export type CycleCcMaster = {
  receiverCc: string;
  receiverDescription: string;
  plantCode: string;
  plantName: string;
  processCode: string;
  processLabel: string;
  displayOrder: number;
  active: boolean;
};

export type CycleReferenceConfig = {
  receiverCc: string;
  peerGroup: string;
  preferredReferenceCc?: string;
  fallbackReferenceCcs: string[];
  confidence: CycleReferenceConfidence;
  reviewStatus: CycleReferenceReviewStatus;
  active: boolean;
};

export type CycleReceiverBaseline = {
  receiverCc: string;
  plantCode: string;
  plantName: string;
  processCode: string;
  processLabel: string;
  displayOrder: number;
  fixedRowCount: number;
  variableRowCount: number;
  fixedNonZeroRowCount: number;
  variableNonZeroRowCount: number;
  baselineStatus: CycleStatus;
};

export type CycleTargetChange = {
  receiverCc: string;
  targetStatus: CycleStatus;
  selectedReferenceCc?: string;
};

export type CycleResolvedAction = {
  receiverCc: string;
  baselineStatus: CycleStatus;
  targetStatus: CycleStatus;
  action: CycleAction;
  referenceCc?: string;
  referenceSource?: CycleReferenceSource;
  fixedAffectedRows: number;
  variableAffectedRows: number;
};

export type CycleDeltaRow = {
  cycle: CycleCode;
  startDate: string;
  segmentName: string;
  receiverCc: string;
  portion: number;
  sourceOrder: number;
};

export const CYCLE_ISSUE_CODES = [
  'WORKBOOK_UNREADABLE',
  'MISSING_REQUIRED_COLUMN',
  'MISSING_FIXED_CYCLE',
  'MISSING_VARIABLE_CYCLE',
  'UNEXPECTED_CYCLE',
  'INVALID_PORTION',
  'DUPLICATE_TARGET_KEY',
  'UNMAPPED_RECEIVER_CC',
  'REFERENCE_NOT_CONFIGURED',
  'REFERENCE_NOT_IN_UPLOAD',
  'REFERENCE_NOT_ACTIVE',
  'REFERENCE_SELF',
  'REFERENCE_SEGMENT_MISSING',
  'REFERENCE_EXTRA_SEGMENT',
  'REFERENCE_FALLBACK_USED',
  'REFERENCE_MAPPING_PROPOSED',
  'NEGATIVE_PORTION',
] as const;

export type CycleIssueCode = (typeof CYCLE_ISSUE_CODES)[number];

export type CycleValidationIssue = {
  code: CycleIssueCode | string;
  severity: CycleIssueSeverity;
  message: string;
  receiverCc?: string;
  cycle?: CycleCode;
  segmentName?: string;
  sourceRowNumber?: number;
  metadata?: Record<string, unknown>;
};

export type CyclePeriodIdentity = {
  fiscalYear: number;
  fiscalPeriod: number;
};

export function getCycleKind(code: CycleCode): CycleKind {
  return code === FIXED_CYCLE_CODE ? 'FIXED' : 'VARIABLE';
}

export function formatCyclePeriodLabel(period: CyclePeriodIdentity): string {
  if (!Number.isInteger(period.fiscalYear) || period.fiscalYear < 2000 || period.fiscalYear > 2200) {
    throw new Error('Invalid fiscal year');
  }
  if (!Number.isInteger(period.fiscalPeriod) || period.fiscalPeriod < 1 || period.fiscalPeriod > 12) {
    throw new Error('Invalid fiscal period');
  }

  return `${INDONESIAN_MONTH_ABBR[period.fiscalPeriod - 1]} ${String(period.fiscalYear).slice(-2)}`;
}

export function formatCycleOutputFileName(kind: CycleKind, period: CyclePeriodIdentity): string {
  const prefix = kind === 'FIXED' ? 'Fix Cost' : 'Var Cost';
  return `${prefix} ${formatCyclePeriodLabel(period)}.xlsx`;
}
