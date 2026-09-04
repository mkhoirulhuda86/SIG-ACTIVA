import type { RawV2CompanyCode } from './constants';

export type RawV2SourceCode =
  | 'TB'
  | 'CC_PROD'
  | 'CC_ADUM'
  | 'CC_PASAR'
  | 'CC_DERIV'
  | 'CC_WHRPG'
  | 'COAL'
  | 'CLINKER_PURCHASE'
  | 'SOLAR_PP_ORDER'
  | 'OA_STAT';

export type RawV2PeriodIdentity = {
  companyCode: RawV2CompanyCode;
  fiscalYear: number;
  fiscalPeriod: number;
};

export type RawV2CapabilityStatus = {
  phase: 'B_SKELETON';
  contractPath: string;
  uploadEnabled: false;
  calculationEnabled: false;
  exportEnabled: false;
  ruleSets: Record<RawV2CompanyCode, string>;
};
