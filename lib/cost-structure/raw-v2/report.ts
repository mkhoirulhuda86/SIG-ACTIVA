export const STAGE_E_IDENTITY = 'E_MAPPING_RINCIAN_SI';

export const REQUIRED_STAGE_E_CONTROL_CODES = [
  'CC_ADUM_MAPPING_COMPLETENESS',
  'CC_PASAR_MAPPING_COMPLETENESS',
  'RINCIAN_ADUM_DELTA_MAPPING_COMPLETENESS',
  'CC_DERIV_MAPPING_COMPLETENESS',
  'RINCIAN_ADUM_RECONCILIATION',
  'RINCIAN_PASAR_RECONCILIATION',
  'DERIV_MAPPING_RECONCILIATION',
  'ADUM_NATURE_RECONCILIATION',
  'PASAR_NATURE_RECONCILIATION',
  'SI_ADUM_RECONCILIATION',
  'SI_PASAR_RECONCILIATION',
  'SI_COMPANY_RECONCILIATION',
] as const;

export const REQUIRED_STAGE_E_RESULT_CODES = [
  'GROUP:ADUM',
  'GROUP:PASAR',
  'COMPANY:SI',
] as const;

type RunCandidate = {
  id: number;
  uploadId: number;
  status: string;
  isActive: boolean;
  ruleSetVersion: string;
  sourceSnapshotJson: unknown;
};

type ExportRun = RunCandidate & {
  controls: { controlCode: string; status: string }[];
  results: { resultCode: string; resultLevel: string }[];
  analyticalRows: unknown[];
};

function snapshotStage(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).stage
    : undefined;
}

/** Operational truth must be unique and active-upload scoped. Ambiguity fails closed. */
export function selectOperationalStageE(runs: RunCandidate[], activeUploadId: number) {
  const candidates = runs.filter((run) =>
    run.uploadId === activeUploadId &&
    run.status === 'SUCCESS' &&
    run.isActive &&
    run.ruleSetVersion === 'ENGINE1_2000_RAW_V3' &&
    snapshotStage(run.sourceSnapshotJson) === STAGE_E_IDENTITY
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export function evaluateRawV2ExportEligibility(input: {
  companyCode: string;
  activeUploadId: number | null;
  run: ExportRun | null;
}) {
  const reasons: string[] = [];
  if (input.companyCode !== '2000') reasons.push('Company 2000 is required.');
  if (!input.activeUploadId) reasons.push('Active Raw V2 upload is required.');
  if (!input.run || (input.activeUploadId && input.run.uploadId !== input.activeUploadId)) {
    reasons.push('Active Stage E SUCCESS for the active upload is required.');
  }

  if (input.run) {
    if (
      input.run.status !== 'SUCCESS' ||
      !input.run.isActive ||
      input.run.ruleSetVersion !== 'ENGINE1_2000_RAW_V3' ||
      snapshotStage(input.run.sourceSnapshotJson) !== STAGE_E_IDENTITY
    ) {
      reasons.push('Run is not an eligible active Stage E SUCCESS.');
    }

    const controlsByCode = new Map(input.run.controls.map((control) => [control.controlCode, control]));
    const missingControls = REQUIRED_STAGE_E_CONTROL_CODES.filter((code) => !controlsByCode.has(code));
    if (missingControls.length) {
      reasons.push(`Required Stage E controls are missing: ${missingControls.join(', ')}.`);
    }
    if (input.run.controls.some((control) => control.status !== 'PASS')) {
      reasons.push('All persisted Stage E controls must be PASS.');
    }

    const resultCodes = new Set(input.run.results.map((result) => result.resultCode));
    const missingResults = REQUIRED_STAGE_E_RESULT_CODES.filter((code) => !resultCodes.has(code));
    if (missingResults.length) {
      reasons.push(`Required Stage E results are missing: ${missingResults.join(', ')}.`);
    }
    if (!input.run.results.some((result) => result.resultLevel === 'NATURE')) {
      reasons.push('Nature results are missing.');
    }
    if (!input.run.analyticalRows.length) reasons.push('Analytical population is empty.');
  }

  return { eligible: reasons.length === 0, reasons };
}
