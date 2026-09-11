export type ActivityKey = 'mom' | 'yoy' | 'ytd';

export type SnapshotLike<T> = {
  id: number;
  fileName: string;
  createdAt: Date;
  rekap: T;
  currentPeriod: string;
  score: number;
};

export function previousMonth(period: string): string {
  const [yearText, monthText] = period.split('.');
  const year = Number(yearText);
  const month = Number(monthText);
  return `${month === 1 ? year - 1 : year}.${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
}

export function previousYear(period: string): string {
  const [yearText, monthText] = period.split('.');
  return `${Number(yearText) - 1}.${monthText}`;
}

export function ytdPeriods(period: string, yearOffset = 0): string[] {
  const [yearText, monthText] = period.split('.');
  const year = Number(yearText) + yearOffset;
  return Array.from({ length: Number(monthText) }, (_, index) => `${year}.${String(index + 1).padStart(2, '0')}`);
}

export function percentOf(previous: number, current: number): number | null {
  const movement = current - previous;
  if (previous === 0) return current === 0 ? 0 : null;
  return (movement / Math.abs(previous)) * 100;
}

export function selectBestSnapshot<T>(candidates: SnapshotLike<T>[], period: string): SnapshotLike<T> | null {
  const usable = candidates.filter((candidate) => candidate.currentPeriod && candidate.score >= 0);
  const exact = usable.filter((candidate) => candidate.currentPeriod === period);
  const pool = exact.length > 0 ? exact : usable.filter((candidate) => candidate.currentPeriod <= period);
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    if (a.currentPeriod !== b.currentPeriod) return b.currentPeriod.localeCompare(a.currentPeriod);
    if (a.score !== b.score) return b.score - a.score;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

export function buildPareto<T extends { accountCode: string; movement: number }>(rows: T[]) {
  const grossMovement = rows.reduce((sum, row) => sum + Math.abs(row.movement), 0);
  let cumulative = 0;
  return [...rows]
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement))
    .map((row) => {
      const contribution = grossMovement === 0 ? 0 : Math.abs(row.movement) / grossMovement;
      const selected = grossMovement > 0 && cumulative < 0.8;
      cumulative += contribution;
      return { ...row, paretoContribution: contribution, paretoCumulative: cumulative, paretoSelected: selected };
    });
}

export function snapshotReasonMatches(snapshotMovement: unknown, normalizedMovement: number): boolean {
  const value = Number(snapshotMovement);
  return Number.isFinite(value) && Math.abs(value - normalizedMovement) < 0.01;
}

export function aggregateAccounts(
  amounts: Map<string, number>,
  accountCodes: readonly string[],
  periods: readonly string[],
): number {
  return accountCodes.reduce(
    (total, accountCode) => total + periods.reduce((subtotal, period) => subtotal + (amounts.get(`${accountCode}|${period}`) ?? 0), 0),
    0,
  );
}
