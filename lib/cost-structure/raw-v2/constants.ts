export const RAW_V2_ENGINE = 'RAW_V2' as const;
export const RAW_V2_PHASE = 'C_RAW_INGESTION' as const;

export const RAW_V2_RULE_SETS = {
  '2000': 'ENGINE1_2000_RAW_V3',
  '7000': 'ENGINE1_7000_RAW_V3',
} as const;

export const RAW_V2_CAPABILITIES = {
  uploadEnabled: true,
  calculationEnabled: false,
  exportEnabled: false,
} as const;

/** Dedicated transaction models; legacy workflow models are intentionally absent. */
export const RAW_V2_WORKFLOW_MODELS = [
  'CostRawV2Period',
  'CostRawV2Upload',
  'CostRawV2Source',
  'CostRawV2SourceRow',
  'CostRawV2ValidationIssue',
  'CostRawV2CalculationRun',
] as const;
