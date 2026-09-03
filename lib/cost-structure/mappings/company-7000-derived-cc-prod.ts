import { Prisma } from '@prisma/client';

export type DerivedCcProdSourceRow = {
  id: number;
  logicalSourceCode: string;
  coaCodeRaw: string | null;
  descriptionRaw: string | null;
  amount: Prisma.Decimal | null;
};

export type DerivedCcProdMappingCandidate = {
  logicalSourceCode: 'CC_PROD';
  coaCode: string;
  description: string;
  total: Prisma.Decimal;
  rowCount: number;
  sourceRowIds: number[];
};

type Aggregate = {
  total: Prisma.Decimal;
  description: string | null;
  rowIds: number[];
};

const zero = () => new Prisma.Decimal(0);

function aggregate(rows: DerivedCcProdSourceRow[], source: string) {
  const result = new Map<string, Aggregate>();
  for (const row of rows) {
    if (row.logicalSourceCode !== source || !row.coaCodeRaw || row.amount === null) continue;
    if (!/^\d{8}$/.test(row.coaCodeRaw)) continue;
    const current = result.get(row.coaCodeRaw) ?? {
      total: zero(),
      description: row.descriptionRaw?.trim() || null,
      rowIds: [],
    };
    current.total = current.total.add(row.amount);
    current.description ||= row.descriptionRaw?.trim() || null;
    current.rowIds.push(row.id);
    result.set(row.coaCodeRaw, current);
  }
  return result;
}

/**
 * Company 7000 ordinary CC_PROD mapping requirement mirrors the base HPP residual:
 * TB account-group-6 - CC_ADUM - raw CC_PASAR. OA-controlled accounts are already
 * present in the literal CC sources in the verified templates and remain governed by
 * their explicit mappings; this helper targets the TB-only gap that previously escaped
 * Phase-D family mapping and failed only when calculation started.
 */
export function deriveCompany7000CcProdMappingCandidates(rows: DerivedCcProdSourceRow[]) {
  const tb = aggregate(rows, 'TB');
  const adum = aggregate(rows, 'CC_ADUM');
  const pasar = aggregate(rows, 'CC_PASAR');
  const result: DerivedCcProdMappingCandidate[] = [];

  for (const [coaCode, base] of tb) {
    if (!coaCode.startsWith('6')) continue;
    const adumItem = adum.get(coaCode);
    const pasarItem = pasar.get(coaCode);
    const total = base.total
      .sub(adumItem?.total ?? zero())
      .sub(pasarItem?.total ?? zero());
    const sourceRowIds = [...new Set([
      ...base.rowIds,
      ...(adumItem?.rowIds ?? []),
      ...(pasarItem?.rowIds ?? []),
    ])];
    result.push({
      logicalSourceCode: 'CC_PROD',
      coaCode,
      description: base.description || coaCode,
      total,
      rowCount: sourceRowIds.length,
      sourceRowIds,
    });
  }
  return result;
}
