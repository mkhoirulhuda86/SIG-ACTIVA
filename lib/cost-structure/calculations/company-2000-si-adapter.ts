import { Prisma } from '@prisma/client';

export type PersistedSupportRow = {
  id: number;
  logicalSourceCode: string;
  sourceRowNumber: number;
  rawData: unknown;
};

export type SiSupportAmount = {
  sourceRowId: number;
  sourceRowNumber: number;
  coaCode: string;
  amount: Prisma.Decimal;
};

export type Company2000SupportControls = {
  rincianAdumTotal: Prisma.Decimal;
  rincianPasarTotal: Prisma.Decimal;
  derivativeDetailTotal: Prisma.Decimal;
  derivativeControlTotal: Prisma.Decimal;
  derivativeSiTotal?: Prisma.Decimal;
};

export type RincianDelta = SiSupportAmount & { groupCode: 'ADUM' | 'PASAR'; rawAmount: Prisma.Decimal };

const zero = () => new Prisma.Decimal(0);
const normalized = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ');
const rawRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cell = (row: PersistedSupportRow, column: number) => rawRecord(row.rawData)[`COLUMN_${column}`];

function decimal(value: unknown, reference: string): Prisma.Decimal {
  const raw = String(value ?? '').trim();
  if (!raw) return zero();
  const negativeParentheses = /^\(.*\)$/.test(raw);
  const trailingMinus = raw.endsWith('-');
  const cleaned = raw.replace(/[(),\s]/g, '').replace(/-$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) throw new Error(`Invalid Decimal amount at ${reference}.`);
  const result = new Prisma.Decimal(cleaned);
  return negativeParentheses || trailingMinus ? result.negated() : result;
}

/** Builds the persisted Rincian analytical base by COA without reopening the workbook. */
export function parseCompany2000Rincian(rows: PersistedSupportRow[]): { ADUM: SiSupportAmount[]; PASAR: SiSupportAmount[] } {
  const ordered = rows.filter((row) => row.logicalSourceCode === 'AUDIT_RINCIAN').sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);
  let columns: { coa: number; adum: number; pasar: number } | null = null;
  const result: { ADUM: SiSupportAmount[]; PASAR: SiSupportAmount[] } = { ADUM: [], PASAR: [] };
  for (const row of ordered) {
    const raw = rawRecord(row.rawData);
    const entries = Object.entries(raw).map(([key, value]) => ({ column: Number(key.replace('COLUMN_', '')), label: normalized(value) }));
    const coa = entries.find((entry) => ['G/L ACC', 'G/L ACCOUNT', 'GL ACCOUNT', 'ACCOUNT', 'COA'].includes(entry.label));
    const adum = entries.find((entry) => ['ADM', 'ADUM'].includes(entry.label));
    const pasar = entries.find((entry) => entry.label === 'PASAR');
    if (coa && adum && pasar) { columns = { coa: coa.column, adum: adum.column, pasar: pasar.column }; continue; }
    if (!columns) continue;
    const coaCode = normalized(cell(row, columns.coa)).match(/^(\d{8})(?:\s|$)/)?.[1];
    if (!coaCode) continue;
    for (const group of ['ADUM', 'PASAR'] as const) {
      const column = group === 'ADUM' ? columns.adum : columns.pasar;
      const value = cell(row, column);
      if (value == null || String(value).trim() === '') continue;
      result[group].push({ sourceRowId: row.id, sourceRowNumber: row.sourceRowNumber, coaCode, amount: decimal(value, `AUDIT_RINCIAN row ${row.sourceRowNumber}`) });
    }
  }
  if (!columns) throw new Error('AUDIT_RINCIAN ADM/PASAR semantic header was not found.');
  return result;
}

export type Company2000SiTotals = {
  adumTotal: Prisma.Decimal;
  pasarTotal: Prisma.Decimal;
};

/** Parses the authoritative SI group totals and converts the workbook's thousand-rupiah unit to rupiah. */
export function parseCompany2000SiTotals(rows: PersistedSupportRow[]): Company2000SiTotals {
  const ordered = rows.filter((row) => row.logicalSourceCode === 'AUDIT_SI').sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);
  let adumTotal: Prisma.Decimal | null = null;
  let pasarTotal: Prisma.Decimal | null = null;

  const assignUnique = (current: Prisma.Decimal | null, value: Prisma.Decimal, label: string) => {
    if (current && !current.equals(value)) throw new Error(`AUDIT_SI contains conflicting ${label} totals.`);
    return value;
  };

  for (const row of ordered) {
    const label = normalized(cell(row, 1));
    if (label !== 'TOTAL ADUM' && label !== 'TOTAL PERNIAGAAN' && label !== 'TOTAL PASAR') continue;
    const rupiah = decimal(cell(row, 2), `AUDIT_SI row ${row.sourceRowNumber}`).mul(1000).toDecimalPlaces(2);
    if (label === 'TOTAL ADUM') adumTotal = assignUnique(adumTotal, rupiah, 'ADUM');
    else pasarTotal = assignUnique(pasarTotal, rupiah, 'PASAR');
  }

  if (!adumTotal) throw new Error('AUDIT_SI Total Adum was not found.');
  if (!pasarTotal) throw new Error('AUDIT_SI Total Perniagaan/Pasar was not found.');
  return { adumTotal, pasarTotal };
}

/**
 * Parses eight-digit CC_DRV details and reconciles them to the persisted Grand Total when the
 * source contributes. CC derivatif is period-optional: no persisted rows, or a present sheet with
 * only blank/zero amounts, has Excel-style zero semantics and does not alter final SI.
 *
 * Persisted AUDIT_CC_DRV intentionally retains workbook header, subtotal, and blank rows for
 * lineage. Only an eight-digit COA row or Grand Total row is financial evidence, so classify the
 * row before parsing COLUMN_30. This keeps labels such as "Sum of Act. Costs" audit-visible
 * without ever treating them as Decimal amounts, while malformed amounts on real data/control
 * rows still fail loudly.
 */
export function parseCompany2000Derivative(rows: PersistedSupportRow[]): { details: SiSupportAmount[]; detailTotal: Prisma.Decimal; controlTotal: Prisma.Decimal; difference: Prisma.Decimal } {
  const derivativeRows = rows.filter((item) => item.logicalSourceCode === 'AUDIT_CC_DRV');
  if (!derivativeRows.length) return { details: [], detailTotal: zero(), controlTotal: zero(), difference: zero() };

  const details: SiSupportAmount[] = [];
  let controlTotal: Prisma.Decimal | null = null;
  let hasNonZeroAmount = false;
  for (const row of derivativeRows) {
    const label = String(cell(row, 29) ?? '').trim();
    const coaCode = label.match(/^\s*(\d{8})(?:\s|$)/)?.[1];
    const isGrandTotal = normalized(label) === 'GRAND TOTAL';
    if (!coaCode && !isGrandTotal) continue;

    const amount = decimal(cell(row, 30), `AUDIT_CC_DRV row ${row.sourceRowNumber}`);
    if (!amount.isZero()) hasNonZeroAmount = true;

    if (coaCode) details.push({ sourceRowId: row.id, sourceRowNumber: row.sourceRowNumber, coaCode, amount });
    else controlTotal = amount;
  }

  const detailTotal = details.reduce((sum, item) => sum.add(item.amount), zero());
  if (controlTotal === null) {
    if (!hasNonZeroAmount) return { details, detailTotal, controlTotal: zero(), difference: zero() };
    throw new Error('AUDIT_CC_DRV Grand Total control was not found for a non-zero derivative source.');
  }

  const difference = detailTotal.sub(controlTotal);
  if (!difference.isZero()) throw new Error(`CC_DRV detail does not reconcile: detail ${detailTotal.toString()}, control ${controlTotal.toString()}.`);
  return { details, detailTotal, controlTotal, difference };
}

export function deriveCompany2000Support(input: {
  rincian: { ADUM: SiSupportAmount[]; PASAR: SiSupportAmount[] };
  derivative: { details: SiSupportAmount[]; detailTotal: Prisma.Decimal; controlTotal: Prisma.Decimal };
  rawByGroup: { ADUM: Map<string, Prisma.Decimal>; PASAR: Map<string, Prisma.Decimal> };
}): { rincianDeltas: RincianDelta[]; derivativeDetails: SiSupportAmount[]; contributingCoaCodes: string[]; controls: Company2000SupportControls } {
  const rincianDeltas: RincianDelta[] = [];
  for (const groupCode of ['ADUM', 'PASAR'] as const) {
    const rincianByCoa = sumSupportByCoa(input.rincian[groupCode]);
    for (const [coaCode, amount] of rincianByCoa) {
      const rawAmount = input.rawByGroup[groupCode].get(coaCode) ?? zero();
      const delta = amount.sub(rawAmount);
      if (delta.isZero()) continue;
      const evidence = input.rincian[groupCode].find((item) => item.coaCode === coaCode)!;
      rincianDeltas.push({ ...evidence, groupCode, rawAmount, amount: delta });
    }
  }
  const derivativeDetails = input.derivative.details.filter((item) => !item.amount.isZero());
  return {
    rincianDeltas,
    derivativeDetails,
    contributingCoaCodes: [...new Set([...rincianDeltas.map((item) => item.coaCode), ...derivativeDetails.map((item) => item.coaCode)])],
    controls: {
      rincianAdumTotal: input.rincian.ADUM.reduce((sum, item) => sum.add(item.amount), zero()),
      rincianPasarTotal: input.rincian.PASAR.reduce((sum, item) => sum.add(item.amount), zero()),
      derivativeDetailTotal: input.derivative.detailTotal,
      derivativeControlTotal: input.derivative.controlTotal,
      derivativeSiTotal: input.derivative.controlTotal,
    },
  };
}

export function assertContributingSupportCoasResolved(contributingCoaCodes: string[], resolvedCoaCodes: Iterable<string>): void {
  const resolved = new Set(resolvedCoaCodes);
  const missing = contributingCoaCodes.find((code) => !resolved.has(code));
  if (missing) throw new Error(`Non-zero Company 2000 SI support contribution for COA ${missing} has no active CostCoa master.`);
}

export function sumSupportByCoa(lines: SiSupportAmount[]): Map<string, Prisma.Decimal> {
  const totals = new Map<string, Prisma.Decimal>();
  for (const line of lines) totals.set(line.coaCode, (totals.get(line.coaCode) ?? zero()).add(line.amount));
  return totals;
}
