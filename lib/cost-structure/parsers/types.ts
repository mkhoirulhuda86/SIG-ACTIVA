export type LogicalSourceCode =
  | 'TB'
  | 'CC_PROD'
  | 'CC_ADUM'
  | 'CC_PASAR'
  | 'CC_WHRPG'
  | 'COAL'
  | 'CLINKER_PURCHASE'
  | 'SOLAR_PP_ORDER'
  | 'OA_STAT'
  | 'ADJUSTMENT'
  | 'AUDIT_SI'
  | 'AUDIT_GHOPO'
  | 'AUDIT_DERIV'
  | 'AUDIT_RINCIAN'
  | 'AUDIT_CC_DRV'
  | 'AUDIT_SI2000_DRV'
  | 'AUDIT_REFERENCE';
export type ParserIssue = { issueCode: string; severity: 'ERROR'|'WARNING'|'INFO'; message: string; rowIndex?: number };
export type ParsedSourceRow = { logicalSourceCode: LogicalSourceCode; originalSheetName: string; sourceRowNumber: number; coaCodeRaw: string|null; descriptionRaw: string|null; amountRaw: string|null; amount: string|null; sourceGroupRaw: string|null; rawDataJson: Record<string, string|null> };
export type ParsedWorkbook = { rows: ParsedSourceRow[]; issues: ParserIssue[]; sources: Array<{ code: LogicalSourceCode; sheetName: string; rowCount: number }> };
