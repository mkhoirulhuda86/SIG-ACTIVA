export const SOURCE_COST_GROUP_CODES = {
  CC_ADUM: 'ADUM',
  CC_PASAR: 'PASAR',
  CC_PROD: 'HPP',
  CC_WHRPG: 'HPP',
} as const;

export type LockedMappingSource = keyof typeof SOURCE_COST_GROUP_CODES;

export function getLockedCostGroupCode(logicalSourceCode: string): string | null {
  return SOURCE_COST_GROUP_CODES[logicalSourceCode as LockedMappingSource] ?? null;
}

export function requireLockedCostGroupCode(logicalSourceCode: string): string {
  const groupCode = getLockedCostGroupCode(logicalSourceCode);
  if (!groupCode) throw new Error(`SOURCE_COST_GROUP_UNSUPPORTED: ${logicalSourceCode} tidak memiliki Cost Group deterministik.`);
  return groupCode;
}
