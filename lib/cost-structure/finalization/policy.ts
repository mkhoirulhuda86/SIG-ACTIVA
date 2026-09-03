import { Prisma } from '@prisma/client';
import { calculateMappingCompleteness, type MappingCompletenessRow } from '../reconciliation/mapping-completeness';
import { isMappingBlockingAmount } from '../reconciliation/money';

const REQUIRED_TOTALS: Record<string, readonly string[]> = {
  '2000': ['TOTAL_ADUM', 'TOTAL_PASAR', 'TOTAL_COMPANY'],
  '7000': ['TOTAL_HPP', 'TOTAL_ADUM', 'TOTAL_PASAR', 'TOTAL_COMPANY'],
};
const REQUIRED_CONTROLS: Record<string, readonly string[]> = {
  '2000': ['ADUM_NATURE_RECONCILIATION', 'PASAR_NATURE_RECONCILIATION'],
  '7000': ['HPP_NATURE_RECONCILIATION', 'ADUM_NATURE_RECONCILIATION', 'PASAR_NATURE_RECONCILIATION'],
};

export class FinalizationError extends Error {}
export type FinalizationSnapshot = {
  companyCode: string;
  periodStatus: string;
  run: null | { id: number; status: string; isActive: boolean; uploadIsActiveVersion: boolean; requiresRecalculation?: boolean };
  unresolvedErrors: number;
  sourceReconciled: boolean;
  mappingComplete: boolean;
  results: Array<{
    resultCode: string;
    resultType: string;
    reconciliationStatus: string | null;
    reconciliationDifference: Prisma.Decimal | string | number | null;
  }>;
};

const isWithinControlTolerance = (value: FinalizationSnapshot['results'][number]['reconciliationDifference']) =>
  value !== null && !isMappingBlockingAmount(new Prisma.Decimal(value).toString());

/** Uses the same per-source/COA aggregation and Rp1 de-minimis policy as Phase D. */
export function mappingCompleteForReadiness(rows: MappingCompletenessRow[]): boolean {
  return calculateMappingCompleteness(rows).unmappedCoaCount === 0;
}

/** Validates persisted Engine-1 results only. No accounting formula is executed here. */
export function assertPersistedControlsReady(snapshot: FinalizationSnapshot, allowedStatuses: readonly string[]) {
  if (snapshot.periodStatus === 'FINALIZED') throw new FinalizationError('Periode FINALIZED bersifat immutable.');
  if (!allowedStatuses.includes(snapshot.periodStatus)) throw new FinalizationError(`Status periode harus ${allowedStatuses.join(' atau ')}.`);
  if (!snapshot.run || snapshot.run.status !== 'SUCCESS') throw new FinalizationError('Active calculation run harus SUCCESS.');
  if (!snapshot.run.isActive) throw new FinalizationError('Calculation run tidak aktif.');
  if (!snapshot.run.uploadIsActiveVersion) throw new FinalizationError('Active calculation run masih terikat ke upload versi lama. Proses upload aktif harus dihitung terlebih dahulu.');
  if (snapshot.run.requiresRecalculation) throw new FinalizationError('Active calculation run stale; jalankan Recalculate sebelum reconciliation/finalization.');
  if (snapshot.unresolvedErrors > 0) throw new FinalizationError('Masih ada validation ERROR yang belum diselesaikan.');
  if (!snapshot.sourceReconciled) throw new FinalizationError('Source reconciliation belum lulus.');
  if (!snapshot.mappingComplete) throw new FinalizationError('Mapping completeness belum lulus.');

  const byCode = new Map(snapshot.results.map((result) => [result.resultCode, result]));
  for (const code of REQUIRED_TOTALS[snapshot.companyCode] ?? []) {
    if (!byCode.has(code)) throw new FinalizationError(`Required result ${code} tidak tersedia.`);
  }
  for (const code of REQUIRED_CONTROLS[snapshot.companyCode] ?? []) {
    const control = byCode.get(code);
    if (!control) throw new FinalizationError(`Required control ${code} tidak tersedia.`);
    if (control.resultType !== 'CONTROL' || !isWithinControlTolerance(control.reconciliationDifference)) {
      throw new FinalizationError(`Control ${code} harus memiliki selisih absolut <= Rp1.`);
    }
  }

  const allControls = snapshot.results.filter((result) => result.resultType === 'CONTROL');
  if (allControls.some((control) => !isWithinControlTolerance(control.reconciliationDifference))) {
    throw new FinalizationError('Semua persisted CONTROL harus memiliki selisih absolut <= Rp1.');
  }
  return snapshot.run.id;
}

export function assertReconciliationReady(snapshot: FinalizationSnapshot) {
  return assertPersistedControlsReady(snapshot, ['CALCULATED']);
}

export function assertFinalizationReady(snapshot: FinalizationSnapshot) {
  return assertPersistedControlsReady(snapshot, ['COST_STRUCTURE_RECONCILED']);
}
