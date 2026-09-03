import { Prisma } from '@prisma/client';
import {
  parseCompany2000Rincian,
  parseCompany2000SiTotals,
  type PersistedSupportRow,
} from '../calculations/company-2000-si-adapter';
import { isMappingBlockingAmount } from './money';
import type { ReconciliationResult } from './types';

export type Company2000HistoricalSupportEvidence = {
  readyByGroup: { ADUM: boolean; PASAR: boolean };
  rincianTotals: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  siTotals: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  differences: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  error: string | null;
};

const zero = () => new Prisma.Decimal(0);

export function evaluateCompany2000HistoricalSupport(rows: PersistedSupportRow[]): Company2000HistoricalSupportEvidence {
  try {
    const rincian = parseCompany2000Rincian(rows);
    const si = parseCompany2000SiTotals(rows);
    const rincianTotals = {
      ADUM: rincian.ADUM.reduce((sum, item) => sum.add(item.amount), zero()),
      PASAR: rincian.PASAR.reduce((sum, item) => sum.add(item.amount), zero()),
    };
    const siTotals = { ADUM: si.adumTotal, PASAR: si.pasarTotal };
    const differences = {
      ADUM: rincianTotals.ADUM.sub(siTotals.ADUM),
      PASAR: rincianTotals.PASAR.sub(siTotals.PASAR),
    };
    return {
      readyByGroup: {
        ADUM: rincian.ADUM.length > 0 && !isMappingBlockingAmount(differences.ADUM.toString()),
        PASAR: rincian.PASAR.length > 0 && !isMappingBlockingAmount(differences.PASAR.toString()),
      },
      rincianTotals,
      siTotals,
      differences,
      error: null,
    };
  } catch (error) {
    return {
      readyByGroup: { ADUM: false, PASAR: false },
      rincianTotals: null,
      siTotals: null,
      differences: null,
      error: error instanceof Error ? error.message : 'Company 2000 historical support could not be evaluated.',
    };
  }
}

export function applyCompany2000HistoricalSourcePolicy(
  companyCode: string,
  logicalSourceCode: string,
  rawResult: ReconciliationResult,
  evidence: Company2000HistoricalSupportEvidence | null
): {
  result: ReconciliationResult;
  fallbackUsed: boolean;
  warningMessage: string | null;
} {
  const group = logicalSourceCode === 'CC_ADUM' ? 'ADUM' : logicalSourceCode === 'CC_PASAR' ? 'PASAR' : null;
  const fallbackEligible = companyCode === '2000'
    && group !== null
    && evidence?.readyByGroup[group]
    && (rawResult.status === 'NOT_RECONCILED' || rawResult.status === 'MISSING_TOTAL');

  if (!fallbackEligible || !group || !evidence?.rincianTotals || !evidence.siTotals || !evidence.differences) {
    return { result: rawResult, fallbackUsed: false, warningMessage: null };
  }

  const debitContext = rawResult.status === 'MISSING_TOTAL'
    ? 'Reported Debit tidak tersedia pada source.'
    : `Detail ${rawResult.detailAmount} tidak sama dengan reported Debit ${rawResult.reportedAmount}; selisih ${rawResult.difference}.`;
  const warningMessage = `${debitContext} Company 2000 historical control dialihkan ke RINCIAN/SI: RINCIAN ${evidence.rincianTotals[group].toString()}, SI ${evidence.siTotals[group].toString()}, selisih ${evidence.differences[group].toString()} (<= Rp1).`;

  return {
    result: { ...rawResult, status: 'RECONCILED', issueCode: null },
    fallbackUsed: true,
    warningMessage,
  };
}
