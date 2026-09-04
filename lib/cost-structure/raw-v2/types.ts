import type { RAW_V2_CAPABILITIES, RAW_V2_ENGINE, RAW_V2_PHASE, RAW_V2_RULE_SETS } from './constants';

export type RawV2Status = {
  engine: typeof RAW_V2_ENGINE;
  phase: typeof RAW_V2_PHASE;
  uploadEnabled: typeof RAW_V2_CAPABILITIES.uploadEnabled;
  calculationEnabled: typeof RAW_V2_CAPABILITIES.calculationEnabled;
  exportEnabled: typeof RAW_V2_CAPABILITIES.exportEnabled;
  ruleSets: typeof RAW_V2_RULE_SETS;
};
