import { ENGINE1_7000_RULE_SET_VERSION } from './company-7000';
import { ENGINE1_2000_RULE_SET_VERSION } from './constants';

export function getCurrentEngine1RuleSetVersion(companyCode: string) {
  if (companyCode === '2000') return ENGINE1_2000_RULE_SET_VERSION;
  if (companyCode === '7000') return ENGINE1_7000_RULE_SET_VERSION;
  throw new Error(`Company ${companyCode} tidak didukung Engine 1.`);
}
