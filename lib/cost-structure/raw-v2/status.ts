import {
  RAW_V2_CAPABILITIES,
  RAW_V2_CONTRACT_PATH,
  RAW_V2_PHASE,
  RAW_V2_RULE_SETS,
} from './constants';
import type { RawV2CapabilityStatus } from './types';

export function getRawV2CapabilityStatus(): RawV2CapabilityStatus {
  return {
    phase: RAW_V2_PHASE,
    contractPath: RAW_V2_CONTRACT_PATH,
    uploadEnabled: RAW_V2_CAPABILITIES.uploadEnabled,
    calculationEnabled: RAW_V2_CAPABILITIES.calculationEnabled,
    exportEnabled: RAW_V2_CAPABILITIES.exportEnabled,
    ruleSets: { ...RAW_V2_RULE_SETS },
  };
}
