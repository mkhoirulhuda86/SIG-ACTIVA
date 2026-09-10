import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFinanceRead } from '@/lib/api-auth';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

const parseNum = (val: unknown): number => {
  if (typeof val === 'number') return val;
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val).trim();
  if (!s) return 0;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }

  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;

  const digitsOnly = s.replace(/[.,]/g, '');
  if (!digitsOnly) return 0;

  const n = Number(digitsOnly);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
};

function amountColToPeriode(ac: {
  label?: unknown;
  yearLabel?: unknown;
  dateLabel?: unknown;
}): string {
  const labelStr = String(ac.label ?? '');
  if (/^\d{4}\.\d{2}$/.test(labelStr)) return labelStr;

  const yr = String(ac.yearLabel ?? '').match(/20\d{2}/)?.[0];
  if (!yr) return '';

  const text = (String(ac.dateLabel ?? '') + ' ' + labelStr).toLowerCase();
  const MONTHS: [string, number][] = [
    ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4],
    ['mei', 5], ['may', 5],
    ['jun', 6], ['jul', 7],
    ['aug', 8], ['agt', 8], ['agu', 8],
    ['sep', 9],
    ['oct', 10], ['okt', 10],
    ['nov', 11],
    ['dec', 12], ['des', 12],
  ];

  for (const [abbr, mo] of MONTHS) {
    if (text.includes(abbr)) return `${yr}.${String(mo).padStart(2, '0')}`;
  }

  return '';
}

type FinalReasonRow = {
  accountCode: string;
  comparisonType: 'MOM' | 'YOY' | 'YTD';
  currentPeriod: string;
  comparisonPeriod: string;
  userComment: string;
  updatedAt: Date;
};

// GET /api/fluktuasi/rekap-amounts
// Returns per-account per-period amounts/reasons from stored rekap snapshots.
// Final user comments override generated/system reasons so Dashboard Resume and
// the working table use the same reviewed narrative.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const [imports, finalReasons] = await Promise.all([
      prisma.fluktuasiImport.findMany({
        select: { rekapSheetData: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.$queryRaw<FinalReasonRow[]>`
        SELECT
          "accountCode",
          "comparisonType",
          "currentPeriod",
          "comparisonPeriod",
          "userComment",
          "updatedAt"
        FROM "fluktuasi_reason_overrides"
        ORDER BY "updatedAt" ASC, "id" ASC
      `,
    ]);

    const dataMap = new Map<string, {
      amount: number;
      reasonMoM: string;
      reasonYoY: string;
      reasonYtD: string;
    }>();

    for (const imp of imports) {
      const rekap = imp.rekapSheetData as Record<string, unknown> | null;
      if (!rekap || typeof rekap !== 'object') continue;

      const rows = rekap.rows as unknown[];
      const amountCols = rekap.amountCols as unknown[];
      const accountColIdx =
        typeof rekap.accountColIdx === 'number' ? rekap.accountColIdx : 0;

      if (!Array.isArray(rows) || !Array.isArray(amountCols)) continue;

      for (const row of rows) {
        const r = row as {
          type?: string;
          values?: unknown[];
          reasonMoM?: unknown;
          reasonYoY?: unknown;
          reasonYtD?: unknown;
        };
        if (r.type !== 'detail') continue;

        const values = Array.isArray(r.values) ? r.values : [];
        const accountCode = String(values[accountColIdx] ?? '').trim();
        if (!accountCode || !/^\d{5,}$/.test(accountCode)) continue;

        const reasonMoM = String(r.reasonMoM ?? '').trim();
        const reasonYoY = String(r.reasonYoY ?? '').trim();
        const reasonYtD = String(r.reasonYtD ?? '').trim();

        for (const ac of amountCols) {
          const a = ac as {
            colIdx?: unknown;
            isCumulative?: unknown;
            label?: unknown;
            yearLabel?: unknown;
            dateLabel?: unknown;
          };

          if (a.isCumulative) continue;

          const colIdx = typeof a.colIdx === 'number' ? a.colIdx : -1;
          if (colIdx < 0 || colIdx >= values.length) continue;

          const periode = amountColToPeriode(a);
          if (!periode) continue;

          const amount = parseNum(values[colIdx]);
          dataMap.set(`${accountCode}|${periode}`, {
            amount,
            reasonMoM,
            reasonYoY,
            reasonYtD,
          });
        }
      }
    }

    // Rows are ordered oldest -> newest. If a user reviewed the same current
    // period with more than one comparison pair, the latest final comment wins
    // for the resume while the detailed table still restores the exact pair.
    for (const reason of finalReasons) {
      const key = `${reason.accountCode}|${reason.currentPeriod}`;
      const current = dataMap.get(key) ?? {
        amount: 0,
        reasonMoM: '',
        reasonYoY: '',
        reasonYtD: '',
      };

      if (reason.comparisonType === 'MOM') current.reasonMoM = reason.userComment;
      if (reason.comparisonType === 'YOY') current.reasonYoY = reason.userComment;
      if (reason.comparisonType === 'YTD') current.reasonYtD = reason.userComment;
      dataMap.set(key, current);
    }

    const data = [...dataMap.entries()].map(([key, payload]) => {
      const pipeIdx = key.indexOf('|');
      return {
        accountCode: key.slice(0, pipeIdx),
        periode: key.slice(pipeIdx + 1),
        amount: payload.amount,
        reasonMoM: payload.reasonMoM,
        reasonYoY: payload.reasonYoY,
        reasonYtD: payload.reasonYtD,
      };
    });

    return NextResponse.json(
      { success: true, data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error fetching rekap amounts:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data rekap amounts' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
