export const STAGE_E_IDENTITY = 'E_MAPPING_RINCIAN_SI';

type RunCandidate = {
  id: number;
  uploadId: number;
  status: string;
  isActive: boolean;
  ruleSetVersion: string;
  sourceSnapshotJson: unknown;
};

function snapshotStage(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).stage
    : undefined;
}

/** Select operational truth explicitly; array order must never decide it. */
export function selectOperationalStageE(runs: RunCandidate[], activeUploadId: number) {
  return runs.find((run) =>
    run.uploadId === activeUploadId &&
    run.status === 'SUCCESS' &&
    run.isActive &&
    run.ruleSetVersion === 'ENGINE1_2000_RAW_V3' &&
    snapshotStage(run.sourceSnapshotJson) === STAGE_E_IDENTITY
  ) ?? null;
}

export function evaluateRawV2ExportEligibility(input: {
  companyCode: string;
  activeUploadId: number | null;
  run: (RunCandidate & { controls: { status: string }[]; results: { resultLevel: string }[]; analyticalRows: unknown[] }) | null;
}) {
  const reasons: string[] = [];
  if (input.companyCode !== '2000') reasons.push('Company 2000 is required.');
  if (!input.activeUploadId) reasons.push('Active Raw V2 upload is required.');
  if (!input.run || (input.activeUploadId && input.run.uploadId !== input.activeUploadId)) reasons.push('Active Stage E SUCCESS for the active upload is required.');
  if (input.run) {
    if (input.run.status !== 'SUCCESS' || !input.run.isActive || input.run.ruleSetVersion !== 'ENGINE1_2000_RAW_V3' || snapshotStage(input.run.sourceSnapshotJson) !== STAGE_E_IDENTITY) reasons.push('Run is not an eligible active Stage E SUCCESS.');
    if (!input.run.controls.length || input.run.controls.some((control) => control.status !== 'PASS')) reasons.push('All persisted Stage E controls must be present and PASS.');
    if (!input.run.results.some((result) => result.resultLevel === 'COMPANY')) reasons.push('Company result is missing.');
    if (!input.run.results.some((result) => result.resultLevel === 'COST_GROUP')) reasons.push('Cost Group results are missing.');
    if (!input.run.results.some((result) => result.resultLevel === 'NATURE')) reasons.push('Nature results are missing.');
    if (!input.run.analyticalRows.length) reasons.push('Analytical population is empty.');
  }
  return { eligible: reasons.length === 0, reasons };
}
