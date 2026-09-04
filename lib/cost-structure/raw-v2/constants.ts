export const RAW_V2_CONTRACT_PATH = 'docs/cost-structure/RAW_SAP_INPUT_CONTRACT_ENGINE1_V2.md';
export const RAW_V2_UI_LABEL = 'Engine 1 V2 – Raw SAP';
export const RAW_V2_PHASE = 'B_SKELETON' as const;

// Keep these identifiers distinct from the existing Engine 1 rule-set names.
// The product label can remain “Engine 1 V2 – Raw SAP”; persisted lineage must never collide.
export const RAW_V2_RULE_SETS = {
  '2000': 'ENGINE1_2000_RAW_V3',
  '7000': 'ENGINE1_7000_RAW_V3',
} as const;

// Stage B deliberately exposes no upload/calculation write path. Stage C enables upload
// only after the locked raw parser + reconciliation contract is implemented and tested.
export const RAW_V2_CAPABILITIES = {
  uploadEnabled: false,
  calculationEnabled: false,
  exportEnabled: false,
} as const;

export type RawV2CompanyCode = keyof typeof RAW_V2_RULE_SETS;
