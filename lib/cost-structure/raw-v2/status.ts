import { RAW_V2_CAPABILITIES, RAW_V2_ENGINE, RAW_V2_PHASE, RAW_V2_RULE_SETS } from './constants';
import type { RawV2Status } from './types';

export function getRawV2Status(): RawV2Status {
  return {
    engine: RAW_V2_ENGINE,
    phase: RAW_V2_PHASE,
    ...RAW_V2_CAPABILITIES,
    ruleSets: RAW_V2_RULE_SETS,
  };
}
