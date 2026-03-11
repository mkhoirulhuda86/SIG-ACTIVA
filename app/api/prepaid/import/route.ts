import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { broadcast } from '@/lib/sse';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

/** Parse Excel serial date OR string like "2026-01", "01/2026", "Jan-26", Date obj */
function parseExcelDate(val: any): Date | null {
  if (!val && val !== 0) return null;

  // Excel serial number
  if (typeof val === 'number' && val > 10000) {
    // XLSX date serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + val * 86400000);
  }

  const s = String(val).trim();

  // YYYY-MM
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  // YYYYMM
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 1);

  // DD/MM/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // MM/YYYY or M/YYYY
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[2], +m[1] - 1, 1);

  // Mon-YY e.g. "Jan-26"
  m = s.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      .findIndex(mn => mn.toLowerCase() === m![1].toLowerCase());
    if (mon >= 0) return new Date(2000 + +m[2], mon, 1);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseNum(val: any): number {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s === '-' || s === '') return 0;
  const n = Number(s.replace(/\./g, '').replace(/,/g, '.'));
  return isNaN(n) ? 0 : n;
}

/** Find column index — tries exact match first, then partial */
function findCol(headers: any[], keywords: string[]): number {
  for (const kw of keywords) {
    const exact = headers.findIndex((h: any) =>
      String(h ?? '').toLowerCase().trim() === kw.toLowerCase()
    );
    if (exact >= 0) return exact;
  }
  for (const kw of keywords) {
    const partial = headers.findIndex((h: any) =>
      String(h ?? '').toLowerCase().trim().includes(kw.toLowerCase())
    );
    if (partial >= 0) return partial;
  }
  return -1;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.match(/\.(xlsx|xls|xlsb)$/i)) {
      return NextResponse.json({ error: 'File harus berformat .xlsx, .xls, atau .xlsb' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

    // Find "Recap" sheet (case-insensitive)
    const sheetName = workbook.SheetNames.find(n =>
      n.trim().toLowerCase() === 'recap' || n.trim().toLowerCase() === 'rekap'
    );
    if (!sheetName) {
      return NextResponse.json(
        { error: `Sheet "Recap" tidak ditemukan. Sheet yang ada: ${workbook.SheetNames.join(', ')}` },
        { status: 400 }
      );
    }

    const ws = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

    if (rawRows.length < 2) {
      return NextResponse.json({ error: 'Sheet Recap tidak memiliki data yang cukup' }, { status: 400 });
    }

    // Find header row (first row that contains "Account" or "Accour" keyword)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
      const row = rawRows[i];
      const hasAccount = row.some((c: any) =>
        /^account$/i.test(String(c ?? '').trim())
      );
      const hasPeriod = row.some((c: any) =>
        /of period/i.test(String(c ?? ''))
      );
      if (hasAccount || hasPeriod) { headerRowIdx = i; break; }
    }
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { error: 'Baris header tidak ditemukan di sheet Recap. Pastikan ada kolom "Account" dan "# of Period".' },
        { status: 400 }
      );
    }

    const headers = rawRows[headerRowIdx];

    // Column indices — exact match takes priority over partial (via findCol)
    const colAccount     = findCol(headers, ['account']);
    const colCompany     = findCol(headers, ['company code', 'company cod', 'bukrs']);
    const colItem        = findCol(headers, ['item']);
    const colGLAccount   = findCol(headers, ['gl account', 'gl accou', 'hkont']);
    const colCostCenter  = findCol(headers, ['cost center', 'kostl']);
    // Amount sources (in priority order)
    const colOpenBalance = findCol(headers, ['opening balance', 'opening balan', 'opening bal']);
    const colPrepaidAmo  = findCol(headers, ['prepaid amo', 'prepaid amount', 'prepaid amt']);
    // Exact "balance" last column — avoid matching "FY25 End Balance" / "Opening Balance"
    const colBalance     = findCol(headers, ['balance']);
    const colDateStart   = findCol(headers, ['date: reclass', 'date:reclass', 'reclass', 'start date']);
    const colDateEnd     = findCol(headers, ['date: end', 'date:end', 'end date', 'finish']);
    const colNumPeriod   = findCol(headers, ['# of period', '#of period', 'of period', 'num period']);
    const colId          = findCol(headers, ['id']);

    // Period month columns (headers "1","2",...,"12")
    const periodColIndices: number[] = [];
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] ?? '').trim();
      if (/^\d{1,2}$/.test(h) && +h >= 1 && +h <= 12) {
        periodColIndices[+h - 1] = i;
      }
    }

    if (colAccount < 0) {
      return NextResponse.json(
        { error: 'Kolom "Account" tidak ditemukan di header. Pastikan nama kolom benar.' },
        { status: 400 }
      );
    }

    const dataRows = rawRows.slice(headerRowIdx + 1);

    // ── Parse semua baris dulu ──────────────────────────────────────────────
    type ParsedRow = {
      kdAkr: string;
      companyCode: string;
      deskripsi: string;
      noPo: string;
      alokasi: string;
      namaAkun: string;
      costCenter: string;
      totalAmount: number;
      numPeriod: number;
      startDate: Date;
      hasPeriodValues: boolean;
      periodeAmounts: number[];
      rowIdx: number;
    };

    const parsedRows: ParsedRow[] = [];
    const warnings: string[] = [];

    for (let ri = 0; ri < dataRows.length; ri++) {
      const row = dataRows[ri];
      const kdAkr = String(row[colAccount] ?? '').trim();
      if (!kdAkr) continue;
      if (kdAkr.toLowerCase().includes('subtotal') || kdAkr.toLowerCase().includes('total')) continue;
      if (!/\d/.test(kdAkr)) continue;

      const openBalanceRaw  = colOpenBalance >= 0 ? parseNum(row[colOpenBalance]) : 0;
      const prepaidAmoRaw   = colPrepaidAmo  >= 0 ? parseNum(row[colPrepaidAmo])  : 0;
      const balanceRaw      = colBalance     >= 0 ? parseNum(row[colBalance])     : 0;
      const totalAmount = Math.abs(openBalanceRaw !== 0 ? openBalanceRaw : prepaidAmoRaw !== 0 ? prepaidAmoRaw : balanceRaw);

      const companyCode = colCompany    >= 0 ? String(row[colCompany]   ?? '').trim() : '';
      const deskripsi   = colItem       >= 0 ? String(row[colItem]      ?? '').trim() : '';
      const idRaw       = colId         >= 0 ? String(row[colId]        ?? '').trim() : '';
      const noPo        = idRaw.startsWith('66') ? idRaw : '';
      const alokasi     = (idRaw && !idRaw.startsWith('66')) ? idRaw : '';
      const namaAkun    = colGLAccount  >= 0 ? String(row[colGLAccount] ?? '').trim() : '';
      const costCenter  = colCostCenter >= 0 ? String(row[colCostCenter]?? '').trim() : '';

      let numPeriod = colNumPeriod >= 0 ? Math.round(Math.abs(parseNum(row[colNumPeriod]))) : 0;
      if (numPeriod <= 0) {
        numPeriod = 12;
        warnings.push(`Baris ${ri + headerRowIdx + 2} (${kdAkr}): # of Period = 0, diset ke default 12 bulan`);
      }

      const startDateRaw = colDateStart >= 0 ? row[colDateStart] : null;
      const endDateRaw   = colDateEnd   >= 0 ? row[colDateEnd]   : null;
      let startDate = parseExcelDate(startDateRaw);
      const endDate = parseExcelDate(endDateRaw);
      if (!startDate && endDate) {
        startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - numPeriod + 1);
      }
      if (!startDate) {
        startDate = new Date();
        startDate.setDate(1);
        warnings.push(`Baris ${ri + headerRowIdx + 2} (${kdAkr}): tanggal tidak valid, diset ke bulan ini`);
      }

      const periodeAmounts: number[] = [];
      let hasPeriodValues = false;
      for (let pi = 0; pi < numPeriod; pi++) {
        const colIdx = periodColIndices[pi];
        if (colIdx !== undefined) {
          const amt = Math.abs(parseNum(row[colIdx]));
          periodeAmounts.push(amt);
          if (amt !== 0) hasPeriodValues = true;
        } else {
          periodeAmounts.push(0);
        }
      }

      parsedRows.push({ kdAkr, companyCode, deskripsi, noPo, alokasi, namaAkun, costCenter,
        totalAmount, numPeriod, startDate: startDate!, hasPeriodValues, periodeAmounts, rowIdx: ri });
    }

    // ── Grouping: rows dengan kdAkr + startDate(bulan/tahun) + numPeriod sama → 1 Prepaid ──
    type GroupKey = string;
    const groups = new Map<GroupKey, ParsedRow[]>();
    for (const pr of parsedRows) {
      const key = `${pr.kdAkr}|${pr.startDate.getFullYear()}-${pr.startDate.getMonth()}|${pr.numPeriod}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pr);
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const [, rows] of groups) {
      const first = rows[0];
      const multiCC = rows.length > 1;

      // totalAmount = sum semua rows (beda cost center punya amount sendiri)
      const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
      const pembagianType = rows.some(r => r.hasPeriodValues) ? 'manual' : 'otomatis';

      // Build periodes: amountPrepaid = sum amount semua cost center di periode ke-n
      const periodes: any[] = [];
      for (let pi = 0; pi < first.numPeriod; pi++) {
        const pd = new Date(first.startDate);
        pd.setMonth(pd.getMonth() + pi);
        const bulanNama = `${BULAN_ID[pd.getMonth()]} ${pd.getFullYear()}`;

        // Sum amount periode ke-pi dari semua rows
        const amtPrepaid = pembagianType === 'manual'
          ? rows.reduce((s, r) => s + (r.periodeAmounts[pi] ?? 0), 0)
          : totalAmount / first.numPeriod;

        // Cost center entries untuk periode ini
        const costcenters = multiCC ? rows.map(r => ({
          costCenter: r.costCenter || undefined,
          kdAkunBiaya: r.namaAkun || undefined,
          amount: pembagianType === 'manual' ? (r.periodeAmounts[pi] ?? 0) : r.totalAmount / first.numPeriod,
        })) : [];

        periodes.push({
          periodeKe: pi + 1,
          bulan: bulanNama,
          tahun: pd.getFullYear(),
          amountPrepaid: amtPrepaid,
          isAmortized: false,
          ...(costcenters.length > 0 ? { costcenters: { create: costcenters } } : {}),
        });
      }

      if (totalAmount === 0) {
        warnings.push(`Akun ${first.kdAkr}: amount=0 - data tetap diimport`);
      }

      try {
        await prisma.prepaid.create({
          data: {
            companyCode: first.companyCode || undefined,
            noPo: first.noPo || undefined,
            kdAkr: first.kdAkr,
            alokasi: first.alokasi,
            namaAkun: first.namaAkun,
            vendor: '',
            deskripsi: first.deskripsi,
            headerText: undefined,
            klasifikasi: undefined,
            totalAmount,
            remaining: totalAmount,
            costCenter: multiCC ? undefined : (first.costCenter || undefined),
            startDate: first.startDate,
            period: first.numPeriod,
            periodUnit: 'bulan',
            type: 'Linear',
            pembagianType,
            periodes: { create: periodes },
          },
        });
        createdCount++;
      } catch (err: any) {
        warnings.push(`ERROR Akun ${first.kdAkr}: ${err.message}`);
        skippedCount++;
      }
    }

    broadcast('prepaid');
    return NextResponse.json({
      success: true,
      created: createdCount,
      skipped: skippedCount,
      warnings: warnings.slice(0, 30),
    });
  } catch (error: any) {
    console.error('Import prepaid error:', error);
    return NextResponse.json({ error: `Gagal mengimpor: ${error.message}` }, { status: 500 });
  }
}
