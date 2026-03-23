import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';

// ─── Colour palette (matches UI) ────────────────────────────────────────────
const C = {
  blue:        'FF4472C4',
  blueDark:    'FF244185',
  red:         'FFC00000',
  navy:        'FF1F3864',
  yellow:      'FFFFC000',
  orange:      'FFE36C09',
  white:       'FFFFFFFF',
  rowAlt:      'FFEFF6FF',  // light blue row stripe (kode akun)
  rowAlt2:     'FFFFF0F0',  // light red row stripe (system cols)
  yellowLight: 'FFFFFBEB',  // GAP cell bg
  yellowLight2:'FFFEF9E0',
  purpleLight: 'FFF0F3FF',  // Reason cell bg
  purpleLight2:'FFE8ECFF',
  grey:        'FFF9FAFB',
};

const border = (color = 'FFD1D5DB'): Partial<ExcelJS.Border> => ({
  style: 'thin', color: { argb: color },
});
const allBorders = (color?: string) => ({
  top: border(color), bottom: border(color),
  left: border(color), right: border(color),
});

const fill = (argb: string): ExcelJS.Fill => ({
  type: 'pattern', pattern: 'solid', fgColor: { argb },
});

const font = (opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: 'Calibri', size: 10, ...opts,
});

function parseNum(val: any): number {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const n = Number(String(val).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ─── POST handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fileName, sheetDataList, rekapSheetData, rekapRowOverrides } = body as {
    fileName: string;
    sheetDataList: any[];
    rekapSheetData: any | null;
    rekapRowOverrides?: Record<string, {
      gapMoM?: number;
      pctMoM?: number;
      reasonMoM?: string;
      gapYoY?: number;
      pctYoY?: number;
      reasonYoY?: string;
      gapYtD?: number;
      pctYtD?: number;
      reasonYtD?: string;
    }>;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIG Activa';
  wb.created = new Date();

  const sheetRowsByCode = new Map<string, Record<string, any>[]>();
  const codesNeedingRows = (sheetDataList ?? [])
    .filter((sd: any) => !Array.isArray(sd?.rows) || sd.rows.length === 0)
    .map((sd: any) => String(sd?.sheetName ?? '').trim())
    .filter(Boolean);

  if (codesNeedingRows.length > 0) {
    const uniqCodes = [...new Set(codesNeedingRows)];
    const records = await prisma.fluktuasiSheetRows.findMany({
      where: { accountCode: { in: uniqCodes } },
      select: { accountCode: true, rows: true },
    });
    for (const rec of records) {
      const rows = Array.isArray(rec.rows) ? (rec.rows as Record<string, any>[]) : [];
      sheetRowsByCode.set(rec.accountCode, rows);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Kode Akun Sheets
  // ──────────────────────────────────────────────────────────────────────────
  for (const sd of sheetDataList) {
    const ws = wb.addWorksheet(sd.sheetName.slice(0, 31));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const origCols: string[] = sd.headers ?? [];
    const addedCols = ['Periode', 'Klasifikasi', 'Remark'];
    const allCols = [...origCols, ...addedCols];

    // ── Header row ──
    const hdrRow = ws.addRow(allCols);
    hdrRow.height = 18;
    hdrRow.eachCell((cell, colNumber) => {
      const isAdded = colNumber > origCols.length;
      cell.fill  = fill(isAdded ? C.red : C.blue);
      cell.font  = font({ bold: true, color: { argb: C.white } });
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = allBorders(isAdded ? 'FF900000' : 'FF3A62A8');
    });

    // ── Data rows ──
    const rows: any[] = Array.isArray(sd.rows) && sd.rows.length > 0
      ? sd.rows
      : (sheetRowsByCode.get(String(sd.sheetName ?? '').trim()) ?? []);
    rows.forEach((row, ri) => {
      const values = [
        ...origCols.map((h: string) => row[h] ?? ''),
        row['__periode'] ?? '',
        row['__klasifikasi'] ?? '',
        row['__remark'] ?? '',
      ];
      const dataRow = ws.addRow(values);
      dataRow.height = 15;
      dataRow.eachCell((cell, colNumber) => {
        const isAdded = colNumber > origCols.length;
        const bgBase = ri % 2 === 0 ? C.white : (isAdded ? C.rowAlt2 : C.rowAlt);
        cell.fill   = fill(isAdded ? (ri % 2 === 0 ? 'FFFFF5F5' : 'FFFFF0F0') : bgBase);
        cell.font   = font({ color: { argb: 'FF374151' } });
        cell.border = allBorders(isAdded ? 'FFFECACA' : 'FFE5E7EB');
        cell.alignment = { vertical: 'middle', wrapText: false };

        // Numbers right-align
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
          cell.alignment = { ...cell.alignment, horizontal: 'right' };
        }
      });
    });

    // ── Column widths ──
    ws.columns.forEach((col, i) => {
      const header = allCols[i] ?? '';
      const sample = rows.slice(0, 30).map((r) => {
        const v = i < origCols.length
          ? String(r[origCols[i]] ?? '')
          : String(r[['__periode','__klasifikasi','__remark'][i - origCols.length]] ?? '');
        return v.length;
      });
      const maxLen = Math.max(header.length, ...sample);
      col.width = Math.min(Math.max(maxLen + 2, 10), 60);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Rekap Sheet
  // ──────────────────────────────────────────────────────────────────────────
  if (rekapSheetData) {
    const ws = wb.addWorksheet(rekapSheetData.sheetName.slice(0, 31));
    ws.views = [{ state: 'frozen', ySplit: 2 }];

    const amountCols: any[] = rekapSheetData.amountCols ?? [];
    const origHeaders: string[] = rekapSheetData.headers ?? [];
    const totalOrigCols = origHeaders.length;

    // system col definitions
    const sysCols = [
      { label: 'GAP MoM',    sub: 'GAP\nMoM',    type: 'gap'    },
      { label: 'MoM %',      sub: 'MoM\n%',       type: 'pct'    },
      { label: 'Reason MoM', sub: 'Reason MoM',   type: 'reason' },
      { label: 'GAP YoY',    sub: 'GAP\nYoY',     type: 'gap'    },
      { label: 'YoY %',      sub: 'YoY\n%',       type: 'pct'    },
      { label: 'Reason YoY', sub: 'Reason YoY',   type: 'reason' },
      { label: 'GAP YtD',    sub: 'GAP\nYtD',     type: 'gap'    },
      { label: 'YtD %',      sub: 'YtD\n%',       type: 'pct'    },
      { label: 'Reason YtD', sub: 'Reason YtD',   type: 'reason' },
    ];

    const totalCols = totalOrigCols + sysCols.length;

    // helper: get color for an amount column
    const amtColBgArgb = (ac: any): string => {
      if (ac.isCumulative) return C.orange;
      const yr = String(ac.yearLabel ?? '').match(/20(\d{2})/);
      if (!yr) return C.blueDark;
      return parseInt(yr[1]) < 26 ? C.navy : C.blueDark;
    };

    // ── Header Row 1 (year group labels) ──
    const hdr1Values: any[] = origHeaders.map((_, i) => {
      const ac = amountCols.find((a: any) => a.colIdx === i);
      return ac ? ac.yearLabel : '';
    });
    sysCols.forEach((sc) => {
      hdr1Values.push(sc.type === 'reason' ? '' : sc.label.split('\n')[0]);
    });

    const hdr1Row = ws.addRow(hdr1Values);
    hdr1Row.height = 16;
    hdr1Row.eachCell((cell, colNumber) => {
      const ci = colNumber - 1;
      let bg: string;
      if (ci < totalOrigCols) {
        const ac = amountCols.find((a: any) => a.colIdx === ci);
        bg = ac ? amtColBgArgb(ac) : C.navy;
      } else {
        const sc = sysCols[ci - totalOrigCols];
        bg = sc.type === 'reason' ? C.navy : sc.type === 'gap' ? C.yellow : C.yellow;
      }
      cell.fill = fill(bg);
      const isYellow = sysCols[ci - totalOrigCols]?.type === 'gap' || sysCols[ci - totalOrigCols]?.type === 'pct';
      cell.font = font({ bold: true, color: { argb: isYellow ? 'FF000000' : C.white }, size: 9 });
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = allBorders('33FFFFFF');
    });

    // Merge consecutive identical year labels in orig col section
    let mergeStart = 0;
    for (let c = 1; c <= totalOrigCols; c++) {
      const prev = hdr1Values[c - 1];
      const curr = c < totalOrigCols ? hdr1Values[c] : null;
      if (curr !== prev || c === totalOrigCols) {
        if (c - 1 > mergeStart) {
          try { ws.mergeCells(1, mergeStart + 1, 1, c); } catch {}
        }
        mergeStart = c;
      }
    }

    // ── Header Row 2 (date labels) ──
    const hdr2Values: any[] = origHeaders.map((h, i) => {
      const ac = amountCols.find((a: any) => a.colIdx === i);
      return ac ? ac.dateLabel : h;
    });
    sysCols.forEach((sc) => hdr2Values.push(sc.sub));

    const hdr2Row = ws.addRow(hdr2Values);
    hdr2Row.height = 22;
    hdr2Row.eachCell((cell, colNumber) => {
      const ci = colNumber - 1;
      let bg: string;
      if (ci < totalOrigCols) {
        const ac = amountCols.find((a: any) => a.colIdx === ci);
        bg = ac ? amtColBgArgb(ac) : C.blueDark;
      } else {
        const sc = sysCols[ci - totalOrigCols];
        bg = sc.type === 'reason' ? C.navy : C.yellow;
      }
      cell.fill = fill(bg);
      const isYellow = ci >= totalOrigCols && sysCols[ci - totalOrigCols]?.type !== 'reason';
      cell.font = font({ bold: true, color: { argb: isYellow ? 'FF000000' : C.white }, size: 9 });
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = allBorders('33FFFFFF');
    });

    // ── Data rows ──
    const rekapRows: any[] = rekapSheetData.rows ?? [];
    rekapRows.forEach((row: any, ri: number) => {
      if (row.type === 'empty') return;

      const rowOverride = rekapRowOverrides?.[String(ri)] ?? {};
      const hasOverride = (key: string) => Object.prototype.hasOwnProperty.call(rowOverride, key);

      const gapMoM = hasOverride('gapMoM') ? Number(rowOverride.gapMoM ?? 0) : Number(row.gapMoM ?? 0);
      const pctMoM = hasOverride('pctMoM') ? Number(rowOverride.pctMoM ?? 0) : Number(row.pctMoM ?? 0);
      const reasonMoM = hasOverride('reasonMoM') ? String(rowOverride.reasonMoM ?? '') : String(row.reasonMoM ?? '');
      const gapYoY = hasOverride('gapYoY') ? Number(rowOverride.gapYoY ?? 0) : Number(row.gapYoY ?? 0);
      const pctYoY = hasOverride('pctYoY') ? Number(rowOverride.pctYoY ?? 0) : Number(row.pctYoY ?? 0);
      const reasonYoY = hasOverride('reasonYoY') ? String(rowOverride.reasonYoY ?? '') : String(row.reasonYoY ?? '');
      const gapYtD = hasOverride('gapYtD') ? Number(rowOverride.gapYtD ?? 0) : Number(row.gapYtD ?? 0);
      const pctYtD = hasOverride('pctYtD') ? Number(rowOverride.pctYtD ?? 0) : Number(row.pctYtD ?? 0);
      const reasonYtD = hasOverride('reasonYtD') ? String(rowOverride.reasonYtD ?? '') : String(row.reasonYtD ?? '');

      const values: any[] = [
        ...origHeaders.map((_: string, i: number) => {
          const ac = amountCols.find((a: any) => a.colIdx === i);
          const rawVal = row.values?.[i] ?? '';
          return ac ? parseNum(rawVal) : rawVal;
        }),
        gapMoM,
        pctMoM / 100,     // store as decimal for Excel % format
        reasonMoM,
        gapYoY,
        pctYoY / 100,
        reasonYoY,
        gapYtD,
        pctYtD / 100,
        reasonYtD,
      ];

      const dataRow = ws.addRow(values);
      dataRow.height = row.type === 'category' ? 18 : 15;

      // Row-level bg
      let rowBg: string;
      if (row.type === 'category') rowBg = C.navy;
      else if (row.type === 'subtotal') rowBg = C.red;
      else rowBg = ri % 2 === 0 ? C.white : C.rowAlt;

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const ci = colNumber - 1;
        const isSpecial = row.type === 'category' || row.type === 'subtotal';

        // Background
        let cellBg = rowBg;
        if (!isSpecial) {
          if (ci >= totalOrigCols) {
            const sc = sysCols[ci - totalOrigCols];
            if (sc.type === 'reason') {
              cellBg = ri % 2 === 0 ? C.purpleLight : C.purpleLight2;
            } else {
              cellBg = ri % 2 === 0 ? C.yellowLight : C.yellowLight2;
            }
          }
        }
        cell.fill = fill(cellBg);

        // Font
        const fontColor = isSpecial ? C.white : (() => {
          if (ci >= totalOrigCols) {
            const sc = sysCols[ci - totalOrigCols];
            if (sc.type === 'gap' || sc.type === 'pct') {
              const v = typeof cell.value === 'number' ? cell.value : 0;
              return v < 0 ? 'FFB91C1C' : v > 0 ? 'FF15803D' : 'FF374151';
            }
          }
          return 'FF374151';
        })();

        cell.font = font({
          bold: row.type !== 'detail',
          color: { argb: fontColor },
        });

        cell.border = allBorders(isSpecial ? '33FFFFFF' : 'FFE5E7EB');
        cell.alignment = { vertical: 'middle' };

        // Number formats
        if (typeof cell.value === 'number') {
          const ci0 = colNumber - 1;
          if (ci0 >= totalOrigCols) {
            const sc = sysCols[ci0 - totalOrigCols];
            if (sc.type === 'pct') {
              cell.numFmt = '0.00%';
              cell.alignment = { ...cell.alignment, horizontal: 'right' };
            } else if (sc.type === 'gap') {
              cell.numFmt = '#,##0';
              cell.alignment = { ...cell.alignment, horizontal: 'right' };
            }
          } else {
            cell.numFmt = '#,##0';
            cell.alignment = { ...cell.alignment, horizontal: 'right' };
          }
        }
      });
    });

    // ── Column widths ──
    ws.columns.forEach((col, i) => {
      if (i < totalOrigCols) {
        const ac = amountCols.find((a: any) => a.colIdx === i);
        col.width = ac ? 16 : 22;
      } else {
        const sc = sysCols[i - totalOrigCols];
        col.width = sc.type === 'reason' ? 40 : 14;
      }
    });
  }

  // ── Serialize ──
  const buffer = await wb.xlsx.writeBuffer();

  const base = (fileName || 'Fluktuasi_OI').replace(/\.[^.]+$/, '');
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}_HASIL.xlsx"`,
    },
  });
}
