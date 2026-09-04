import { Prisma } from '@prisma/client';

export type RawReconciliationRow = { id?: number; logicalSourceCode: string; coaCodeRaw: string | null; amount: Prisma.Decimal | null };
export type RawDerivControl = { presenceStatus: string; detailRowCount: number; nonZeroDetailRowCount: number; detailTotal: Prisma.Decimal | null; debitControl: Prisma.Decimal | null; reconciliationDifference: Prisma.Decimal | null };
const ZERO = new Prisma.Decimal(0);

function aggregate(rows: RawReconciliationRow[], source: string) {
  const amounts = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (row.logicalSourceCode !== source || !row.coaCodeRaw || row.amount === null) continue;
    amounts.set(row.coaCodeRaw, (amounts.get(row.coaCodeRaw) ?? ZERO).plus(row.amount));
  }
  return amounts;
}

/** Exact Company 2000 equality. DERIV is intentionally not an input. Difference is CC - TB. */
export function reconcileCompany2000(rows: RawReconciliationRow[], deriv: RawDerivControl) {
  const tb = aggregate(rows, 'TB');
  const adum = aggregate(rows, 'CC_ADUM');
  const pasar = aggregate(rows, 'CC_PASAR');
  const coaCodes = [...new Set([...adum.keys(), ...pasar.keys()])].sort();
  let totalAdum = ZERO, totalPasar = ZERO, totalTbPopulation = ZERO;
  const details = coaCodes.map((coaCode) => {
    const adumAmount = adum.get(coaCode) ?? ZERO;
    const pasarAmount = pasar.get(coaCode) ?? ZERO;
    const ccAmount = adumAmount.plus(pasarAmount);
    const tbAmount = tb.get(coaCode);
    const difference = tbAmount === undefined ? null : ccAmount.minus(tbAmount);
    totalAdum = totalAdum.plus(adumAmount); totalPasar = totalPasar.plus(pasarAmount);
    if (tbAmount !== undefined) totalTbPopulation = totalTbPopulation.plus(tbAmount);
    return { coaCode, adumAmount, pasarAmount, ccAmount, tbAmount: tbAmount ?? null, difference, status: tbAmount === undefined ? 'MISSING_TB' : difference!.isZero() ? 'MATCH' : 'MISMATCH' } as const;
  });
  const totalBaseCc = totalAdum.plus(totalPasar);
  const totalDifference = totalBaseCc.minus(totalTbPopulation);
  const derivCoas = aggregate(rows, 'CC_DERIV');
  const derivPasarCoverageMissing = [...derivCoas].filter(([, amount]) => !amount.isZero()).filter(([coa]) => !pasar.has(coa)).length;
  const missingInTbCount = details.filter((row) => row.status === 'MISSING_TB').length;
  const mismatchCount = details.filter((row) => row.status === 'MISMATCH').length;
  const derivSourcePass = deriv.presenceStatus === 'ABSENT_TREATED_AS_ZERO' || deriv.reconciliationDifference?.isZero() === true;
  const pass = missingInTbCount === 0 && mismatchCount === 0 && totalDifference.isZero() && derivSourcePass;
  return {
    status: pass ? 'PASS' : 'FAIL', details, tbRowCount: tb.size,
    tbNonZeroCount: [...tb.values()].filter((amount) => !amount.isZero()).length,
    uniqueCcCoaCount: coaCodes.length, foundInTbCount: coaCodes.length - missingInTbCount, missingInTbCount,
    exactMatchCount: details.filter((row) => row.status === 'MATCH').length, mismatchCount,
    totalAdum, totalPasar, totalBaseCc, totalTbPopulation, totalDifference,
    deriv: { presenceStatus: deriv.presenceStatus, detailRowCount: deriv.detailRowCount, nonZeroCount: deriv.nonZeroDetailRowCount, total: deriv.detailTotal ?? ZERO, debitControl: deriv.debitControl, sourceDifference: deriv.reconciliationDifference, pasarCoverageMissing: derivPasarCoverageMissing },
  } as const;
}

export function rawV2ActivationDecision(status: 'PASS' | 'FAIL') {
  return status === 'PASS'
    ? { runStatus: 'SUCCESS' as const, activateNew: true, deactivatePrevious: true, periodStatus: 'CALCULATED' as const }
    : { runStatus: 'FAILED' as const, activateNew: false, deactivatePrevious: false, periodStatus: null };
}
