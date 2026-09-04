import type { Prisma } from '@prisma/client';

export type RawV2LogicalSource = 'TB' | 'CC_ADUM' | 'CC_PASAR' | 'CC_PROD' | 'CC_DERIV';
export type RawV2Severity = 'INFO' | 'WARNING' | 'ERROR';

export type RawV2ParserIssue = {
  issueCode: string;
  severity: RawV2Severity;
  message: string;
  logicalSourceCode?: string;
  originalSheetName?: string;
  sourceRowNumber?: number;
};

export type RawV2ParsedRow = {
  logicalSourceCode: string;
  originalSheetName: string;
  sourceRowNumber: number;
  rawDataJson: Prisma.InputJsonValue;
  normalizedDataJson?: Prisma.InputJsonValue;
  coaCodeRaw?: string;
  descriptionRaw?: string;
  amount?: string;
  normalizationStatus: 'FINANCIAL_DETAIL' | 'NON_FINANCIAL_LINEAGE' | 'INVALID';
};

export type RawV2ParsedSource = {
  logicalSourceCode: string;
  originalSheetName?: string;
  presenceStatus: 'PRESENT' | 'ABSENT_TREATED_AS_ZERO';
  companyCode: string;
  fiscalYear?: number;
  fiscalPeriod?: number;
  controllingArea?: string;
  costCenterGroup?: string;
  headerRowNumber?: number;
  detailRowCount: number;
  nonZeroDetailRowCount: number;
  detailTotal?: string;
  debitControl?: string;
  overUnderControl?: string;
  reconciliationDifference?: string;
  metadataJson?: Prisma.InputJsonValue;
};

export type RawV2UploadContext = { companyCode: string; fiscalYear: number; fiscalPeriod: number };
export type RawV2ParsedWorkbook = {
  detectedPeriod?: { fiscalYear: number; fiscalPeriod: number };
  sources: RawV2ParsedSource[];
  rows: RawV2ParsedRow[];
  issues: RawV2ParserIssue[];
};
