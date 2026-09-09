import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFinanceRead } from '@/lib/api-auth';
import { buildPareto, percentOf, previousMonth, previousYear, selectBestSnapshot as chooseBestSnapshot, snapshotReasonMatches, ytdPeriods } from '@/lib/fluktuasi/dashboard-resume';

type ActivityKey = 'mom' | 'yoy' | 'ytd';
type ClassificationKey = 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';

type AmountCol = {
  colIdx?: unknown;
  label?: unknown;
  yearLabel?: unknown;
  dateLabel?: unknown;
  isCumulative?: unknown;
};

type RekapRow = Record<string, unknown> & {
  type?: unknown;
  values?: unknown;
  gapMoM?: unknown;
  gapYoY?: unknown;
  gapYtD?: unknown;
  reasonMoM?: unknown;
  reasonYoY?: unknown;
  reasonYtD?: unknown;
};

type RekapData = Record<string, unknown> & {
  rows?: unknown;
  amountCols?: unknown;
  accountColIdx?: unknown;
  momCurrIdx?: unknown;
};

type SnapshotCandidate = {
  id: number;
  fileName: string;
  createdAt: Date;
  rekap: RekapData;
  currentPeriod: string;
  score: number;
};

const CLASSIFICATIONS: Array<{
  key: ClassificationKey;
  title: string;
  fallbackAccounts: string[];
}> = [
  {
    key: 'beban-bunga',
    title: 'Beban Bunga',
    fallbackAccounts: ['71510001', '71510002', '71510003', '71510004', '71510005', '71510098', '71510099'],
  },
  {
    key: 'pendapatan-lain',
    title: 'Pendapatan Lain-Lain',
    fallbackAccounts: ['71410001', '71410009', '71421001', '71421002', '71421009', '71430001', '71430002', '71440001', '71460001', '71460002', '71460009', '71560001'],
  },
  {
    key: 'pendapatan-bunga',
    title: 'Pendapatan Bunga',
    fallbackAccounts: ['71310001', '71310002', '71320001', '71320002'],
  },
  {
    key: 'selisih-kurs',
    title: 'Laba (Rugi) Selisih Kurs',
    fallbackAccounts: ['71610001', '71610002', '71620001', '71620002', '71620004'],
  },
];

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  '71510001': 'BEBAN BUNGA PINJAMAN INVESTASI',
  '71510002': 'BEBAN BUNGA PINJAMAN MODAL KERJA',
  '71510003': 'BEBAN BUNGA OBLIGASI',
  '71510004': 'BEBAN BUNGA SEWA PEMBIAYAAN',
  '71510005': 'DERIVATIVE INSTRUMENT INTEREST EXPENSES',
  '71510098': 'BEBAN BUNGA (PSAK 57)',
  '71510099': 'BEBAN BUNGA LAIN - LAIN',
  '71410001': 'PENDAPATAN KLAIM ASURANSI',
  '71410009': 'PENDAPATAN KLAIM LAINNYA',
  '71421001': 'PENDAPATAN HASIL ANALISA',
  '71421002': 'PENDAPATAN JASA PELABUHAN',
  '71421009': 'PENDAPATAN JASA LAINNYA',
  '71430001': 'PENDAPATAN SEWA TANAH',
  '71430002': 'PENDAPATAN SEWA BANGUNAN',
  '71440001': 'PENDAPATAN PENJUALAN AFVAL',
  '71460001': 'PENDAPATAN PEMAKAIAN LISTRIK',
  '71460002': 'PENDAPATAN PEMAKAIAN AIR',
  '71460009': 'PENDAPATAN LAIN-LAIN',
  '71560001': 'BEBAN LAIN-LAINNYA',
  '71310001': 'PENDAPATAN BUNGA DEPOSITO',
  '71310002': 'PENDAPATAN JASA GIRO',
  '71320001': 'PENDAPATAN CICILAN',
  '71320002': 'PENDAPATAN BUNGA OBLIGASI',
  '71610001': 'LABA SELISIH KURS [REALISED]',
  '71610002': 'RUGI SELISIH KURS [REALISED]',
  '71620001': 'LABA SELISIH KURS [UNREALISED]',
  '71620002': 'RUGI SELISIH KURS [UNREALISED]',
  '71620004': 'EXCHANGE RATE DIFFERENCE UTK PEMBELIAN',
};

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function amountColToPeriod(ac: AmountCol): string {
  const label = String(ac.label ?? '').trim();
  if (/^\d{4}\.\d{2}$/.test(label)) return label;

  const text = `${String(ac.yearLabel ?? '')} ${String(ac.dateLabel ?? '')} ${label}`;
  const year4 = text.match(/(20\d{2})/)?.[1];
  const year2 = text.match(/(?:'|\b)(\d{2})(?!\d)/)?.[1];
  const year = year4 ? Number(year4) : year2 ? 2000 + Number(year2) : NaN;
  if (!Number.isFinite(year)) return '';

  const lower = text.toLowerCase();
  const monthTokens: Array<[RegExp, number]> = [
    [/\bjan(?:uari)?\b/, 1], [/\bfeb(?:ruari)?\b/, 2], [/\bmar(?:et)?\b/, 3],
    [/\bapr(?:il)?\b/, 4], [/\b(?:mei|may)\b/, 5], [/\bjun(?:i)?\b/, 6],
    [/\bjul(?:i)?\b/, 7], [/\b(?:agu(?:stus)?|agt|aug(?:ust)?)\b/, 8],
    [/\bsep(?:t(?:ember)?)?\b/, 9], [/\b(?:okt(?:ober)?|oct(?:ober)?)\b/, 10],
    [/\bnov(?:ember)?\b/, 11], [/\b(?:des(?:ember)?|dec(?:ember)?)\b/, 12],
  ];
  for (const [pattern, month] of monthTokens) {
    if (pattern.test(lower)) return `${year}.${String(month).padStart(2, '0')}`;
  }
  return '';
}

function rekapRows(rekap: RekapData): RekapRow[] {
  return Array.isArray(rekap.rows) ? (rekap.rows as RekapRow[]) : [];
}

function rekapAmountCols(rekap: RekapData): AmountCol[] {
  return Array.isArray(rekap.amountCols) ? (rekap.amountCols as AmountCol[]) : [];
}

function snapshotCurrentPeriod(rekap: RekapData): string {
  const cols = rekapAmountCols(rekap);
  const rawIdx = typeof rekap.momCurrIdx === 'number' ? rekap.momCurrIdx : cols.length - 1;
  const col = cols[rawIdx] ?? cols.filter((c) => !c.isCumulative).at(-1);
  return col ? amountColToPeriod(col) : '';
}

function snapshotScore(rekap: RekapData): number {
  const rows = rekapRows(rekap);
  const cols = rekapAmountCols(rekap);
  const details = rows.filter((row) => row.type === 'detail');
  if (details.length === 0 || cols.length === 0) return -1;

  let movementEvidence = 0;
  let reasonEvidence = 0;
  for (const row of details) {
    if (Math.abs(Number(row.gapMoM ?? 0)) > 0 || Math.abs(Number(row.gapYoY ?? 0)) > 0 || Math.abs(Number(row.gapYtD ?? 0)) > 0) {
      movementEvidence += 1;
    }
    if (String(row.reasonMoM ?? '').trim() || String(row.reasonYoY ?? '').trim() || String(row.reasonYtD ?? '').trim()) {
      reasonEvidence += 1;
    }
  }
  return details.length * 1000 + movementEvidence * 20 + reasonEvidence * 5 + cols.length;
}

function selectBestSnapshot(
  imports: Array<{ id: number; fileName: string; createdAt: Date; rekapSheetData: unknown }>,
  period: string,
): SnapshotCandidate | null {
  const candidates: SnapshotCandidate[] = [];
  for (const imp of imports) {
    if (!imp.rekapSheetData || typeof imp.rekapSheetData !== 'object') continue;
    const rekap = imp.rekapSheetData as RekapData;
    const currentPeriod = snapshotCurrentPeriod(rekap);
    const score = snapshotScore(rekap);
    if (!currentPeriod || score < 0) continue;
    candidates.push({ id: imp.id, fileName: imp.fileName, createdAt: imp.createdAt, rekap, currentPeriod, score });
  }

  return chooseBestSnapshot(candidates, period);
}

function parseClassificationKey(value: string): ClassificationKey | null {
  const text = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (text.includes('beban bunga')) return 'beban-bunga';
  if (text.includes('pendapatan lain') || text.includes('pendapatan klaim')) return 'pendapatan-lain';
  if (text.includes('pendapatan bunga')) return 'pendapatan-bunga';
  if (text.includes('selisih kurs')) return 'selisih-kurs';
  return null;
}

function buildSnapshotAccountMeta(snapshot: SnapshotCandidate | null) {
  const accountOrder = new Map<ClassificationKey, string[]>();
  const descriptions = new Map<string, string>();
  const reasons = new Map<string, RekapRow>();
  for (const item of CLASSIFICATIONS) accountOrder.set(item.key, []);

  if (!snapshot) {
    for (const item of CLASSIFICATIONS) accountOrder.set(item.key, [...item.fallbackAccounts]);
    return { accountOrder, descriptions, reasons };
  }

  const accountColIdx = typeof snapshot.rekap.accountColIdx === 'number' ? snapshot.rekap.accountColIdx : 0;
  let currentClass: ClassificationKey | null = null;
  for (const row of rekapRows(snapshot.rekap)) {
    const values = Array.isArray(row.values) ? (row.values as unknown[]) : [];
    const accountCode = String(values[accountColIdx] ?? '').trim();
    const description = String(values[accountColIdx === 0 ? 1 : 0] ?? '').trim();

    if (row.type === 'category') {
      currentClass = parseClassificationKey(description || String(values[1] ?? values[0] ?? ''));
      continue;
    }
    if (row.type !== 'detail' || !currentClass || !/^\d{5,}$/.test(accountCode)) continue;

    const list = accountOrder.get(currentClass) ?? [];
    if (!list.includes(accountCode)) list.push(accountCode);
    accountOrder.set(currentClass, list);
    if (description) descriptions.set(accountCode, description);
    reasons.set(accountCode, row);
  }

  for (const item of CLASSIFICATIONS) {
    const allowed = new Set(item.fallbackAccounts);
    const ordered = (accountOrder.get(item.key) ?? []).filter((code) => allowed.has(code));
    for (const code of item.fallbackAccounts) if (!ordered.includes(code)) ordered.push(code);
    accountOrder.set(item.key, ordered);
  }
  return { accountOrder, descriptions, reasons };
}

function periodLabel(period: string): string {
  const [yearText, monthText] = period.split('.');
  const month = Number(monthText);
  return `${MONTHS_ID[month - 1] ?? monthText} ${yearText}`;
}

function getReason(row: RekapRow | undefined, activity: ActivityKey): string {
  if (!row) return '';
  const sourceField = activity === 'mom' ? 'sourceReasonMoM' : activity === 'yoy' ? 'sourceReasonYoY' : 'sourceReasonYtD';
  const legacyField = activity === 'mom' ? 'reasonMoM' : activity === 'yoy' ? 'reasonYoY' : 'reasonYtD';
  const source = String(row[sourceField] ?? '').trim();
  return source || String(row[legacyField] ?? '').trim();
}

function activityPeriods(activity: ActivityKey, currentPeriod: string) {
  if (activity === 'mom') {
    const previous = previousMonth(currentPeriod);
    return {
      currentPeriods: [currentPeriod],
      previousPeriods: [previous],
      currentLabel: periodLabel(currentPeriod),
      previousLabel: periodLabel(previous),
      label: `MoM: ${periodLabel(currentPeriod)} vs ${periodLabel(previous)}`,
    };
  }
  if (activity === 'yoy') {
    const previous = previousYear(currentPeriod);
    return {
      currentPeriods: [currentPeriod],
      previousPeriods: [previous],
      currentLabel: periodLabel(currentPeriod),
      previousLabel: periodLabel(previous),
      label: `YoY: ${periodLabel(currentPeriod)} vs ${periodLabel(previous)}`,
    };
  }

  const currentPeriods = ytdPeriods(currentPeriod);
  const previousPeriods = ytdPeriods(currentPeriod, -1);
  const [yearText, monthText] = currentPeriod.split('.');
  const month = Number(monthText);
  const currentLabel = `Jan-${MONTHS_ID[month - 1]} ${yearText}`;
  const previousLabel = `Jan-${MONTHS_ID[month - 1]} ${Number(yearText) - 1}`;
  return {
    currentPeriods,
    previousPeriods,
    currentLabel,
    previousLabel,
    label: `YTD: ${currentLabel} vs ${previousLabel}`,
  };
}

function amountForPeriods(amountMap: Map<string, number>, accountCode: string, periods: string[]): number {
  return periods.reduce((total, period) => total + (amountMap.get(`${accountCode}|${period}`) ?? 0), 0);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const requestedPeriod = new URL(request.url).searchParams.get('periode')?.trim() ?? '';
    if (requestedPeriod && !/^\d{4}\.\d{2}$/.test(requestedPeriod)) {
      return NextResponse.json({ success: false, error: 'Format periode harus YYYY.MM' }, { status: 400 });
    }

    const [amountRecords, imports] = await Promise.all([
      prisma.fluktuasiAkunPeriode.findMany({
        select: { accountCode: true, periode: true, amount: true, remark: true, klasifikasi: true },
        orderBy: [{ periode: 'asc' }, { accountCode: 'asc' }],
      }),
      prisma.fluktuasiImport.findMany({
        select: { id: true, fileName: true, createdAt: true, rekapSheetData: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const periodOptions = [...new Set(amountRecords.map((row) => row.periode).filter((period) => /^\d{4}\.\d{2}$/.test(period)))].sort();
    const period = requestedPeriod || periodOptions.at(-1) || '';
    if (!period) {
      return NextResponse.json({ success: true, data: { period: '', periodOptions: [], classifications: [], source: null } });
    }

    const snapshot = selectBestSnapshot(imports, period);
    const { accountOrder, descriptions, reasons } = buildSnapshotAccountMeta(snapshot);
    const availablePeriods = new Set(periodOptions);
    const amountMap = new Map<string, number>();
    for (const row of amountRecords) amountMap.set(`${row.accountCode}|${row.periode}`, Number(row.amount ?? 0));
    const recordMap = new Map(amountRecords.map((row) => [`${row.accountCode}|${row.periode}`, row]));

    const classifications = CLASSIFICATIONS.map((classification) => {
      const accounts = accountOrder.get(classification.key) ?? classification.fallbackAccounts;
      const activities = Object.fromEntries((['mom', 'yoy', 'ytd'] as ActivityKey[]).map((activity) => {
        const periods = activityPeriods(activity, period);
        const missingPeriods = [...periods.currentPeriods, ...periods.previousPeriods].filter((p) => !availablePeriods.has(p));
        const available = missingPeriods.length === 0;

        const rawRows = accounts.map((accountCode) => {
          const previous = available ? amountForPeriods(amountMap, accountCode, periods.previousPeriods) : 0;
          const current = available ? amountForPeriods(amountMap, accountCode, periods.currentPeriods) : 0;
          const movement = current - previous;
          return {
            accountCode,
            description: descriptions.get(accountCode) || FALLBACK_DESCRIPTIONS[accountCode] || accountCode,
            previous,
            current,
            movement,
            percent: available ? percentOf(previous, current) : null,
            reason: (() => {
              const snapshotRow = reasons.get(accountCode);
              const snapshotMovement = activity === 'mom' ? snapshotRow?.gapMoM : activity === 'yoy' ? snapshotRow?.gapYoY : snapshotRow?.gapYtD;
              const sourceReason = snapshotReasonMatches(snapshotMovement, movement) ? getReason(snapshotRow, activity) : '';
              if (sourceReason) return sourceReason;
              const fallbackRecords = periods.currentPeriods.map((p) => recordMap.get(`${accountCode}|${p}`)).filter(Boolean);
              const values = fallbackRecords.map((record) => String(record?.remark || record?.klasifikasi || '').trim()).filter(Boolean);
              return [...new Set(values)].join('; ');
            })(),
          };
        });

        const rankedRows = buildPareto(rawRows);
        const rankMap = new Map(rankedRows.map((row) => [row.accountCode, row]));
        const rows = rawRows.map((row) => rankMap.get(row.accountCode) ?? { ...row, paretoContribution: 0, paretoCumulative: 0, paretoSelected: false });
        const previous = rows.reduce((sum, row) => sum + row.previous, 0);
        const current = rows.reduce((sum, row) => sum + row.current, 0);
        const movement = current - previous;
        const percent = available ? percentOf(previous, current) : null;

        return [activity, {
          key: activity,
          label: periods.label,
          currentLabel: periods.currentLabel,
          previousLabel: periods.previousLabel,
          available,
          missingPeriods,
          kpi: { previous, current, movement, percent },
          rows,
          pareto: rows
            .filter((row) => row.paretoSelected)
            .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement)),
        }];
      }));

      return {
        key: classification.key,
        title: classification.title,
        accountCount: accounts.length,
        activities,
      };
    });

    const response = NextResponse.json({
      success: true,
      data: {
        period,
        periodLabel: periodLabel(period),
        periodOptions,
        classifications,
        source: snapshot ? {
          importId: snapshot.id,
          fileName: snapshot.fileName,
          createdAt: snapshot.createdAt.toISOString(),
          rekapPeriod: snapshot.currentPeriod,
          qualityScore: snapshot.score,
        } : null,
      },
    });
    response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    return response;
  } catch (error) {
    console.error('Error building fluktuasi dashboard:', error);
    return NextResponse.json({ success: false, error: 'Gagal membangun Dashboard Resume fluktuasi' }, { status: 500 });
  }
}
