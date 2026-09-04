import type { RawV2LogicalSource } from './types';
import { semanticText } from './amount';

const GROUPS_2000: Record<string, RawV2LogicalSource> = {
  SI2000_ADM: 'CC_ADUM', SI2000_PSR: 'CC_PASAR', SI2000_DRV: 'CC_DERIV',
};

export function classifyCostCenterGroup(companyCode: string, group: string) {
  return companyCode === '2000' ? GROUPS_2000[semanticText(group).toUpperCase()] : undefined;
}

export function sheetNameHint(name: string): RawV2LogicalSource | undefined {
  const value = semanticText(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (/(^|_)TB($|_)/.test(value) || value.includes('TRIAL_BALANCE')) return 'TB';
  if (value.includes('ADUM') || value.includes('ADM')) return 'CC_ADUM';
  if (value.includes('PASAR') || value.includes('PSR')) return 'CC_PASAR';
  if (value.includes('DERIV') || value.includes('DRV')) return 'CC_DERIV';
  if (value.includes('PROD')) return 'CC_PROD';
}
