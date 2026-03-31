import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { requireFinanceRead } from '@/lib/api-auth';

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

/**
 * Convert an AmountCol descriptor to a YYYY.MM period string.
 * Handles both:
 *  - Synthetic rekap (buildRekapFromAkunPeriodes): label is already "YYYY.MM"
 *  - Real Excel rekap: parse year from yearLabel, month from dateLabel / label text
 */
function amountColToPeriode(ac: {
  label?: unknown;
  yearLabel?: unknown;
  dateLabel?: unknown;
}): string {
  const labelStr = String(ac.label ?? '');

  // Synthetic rekap stores label as "YYYY.MM" directly
  if (/^\d{4}\.\d{2}$/.test(labelStr)) return labelStr;

  // Real Excel rekap: extract 4-digit year from yearLabel
  const yr = String(ac.yearLabel ?? '').match(/20\d{2}/)?.[0];
  if (!yr) return '';

  // Combine dateLabel + label to find month abbreviation
  const text = (String(ac.dateLabel ?? '') + ' ' + labelStr).toLowerCase();

  const MONTHS: [string, number][] = [
    ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4],
    ['mei', 5], ['may', 5],
    ['jun', 6], ['jul', 7],
    ['aug', 8], ['agt', 8],
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

// GET /api/fluktuasi/rekap-amounts
// Returns per-account per-period amounts extracted from all stored FluktuasiImport.rekapSheetData.
// Covers accounts that only appear in the REKAP sheet and not in individual account sheets.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    // Fetch all imports oldest-first so latest values overwrite older ones.
    const imports = await prisma.fluktuasiImport.findMany({
      select: { rekapSheetData: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Merge map: "accountCode|periode" -> payload (latest import wins)
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
        // Only include real account codes (5+ digits)
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

          // Skip cumulative / YTD columns — only use monthly point-in-time columns
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

    const res = NextResponse.json({ success: true, data });
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching rekap amounts:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data rekap amounts' },
      { status: 500 },
    );
  }
}
