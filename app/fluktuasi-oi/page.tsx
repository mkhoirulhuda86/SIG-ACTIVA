'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { Upload, FileSpreadsheet, Download, ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type SheetData = {
  sheetName: string;
  headers: string[];
  originalHeaders: string[]; // for display
  rows: Record<string, any>[];
};

/** Parsed amount column from rekap sheet */
type AmountCol = {
  colIdx: number;        // index in headers array
  label: string;         // original header label
  yearLabel: string;     // top row label (e.g. "2025", "2026")
  dateLabel: string;     // bottom row label (e.g. "31-Jan-25")
  isCumulative: boolean; // "Total Up to" / "Up to" type column
};

type RekapSheetRow = {
  values: (string | number)[];
  type: 'category' | 'subtotal' | 'detail' | 'empty';
  gapMoM: number;
  pctMoM: number;
  gapYoY: number;
  pctYoY: number;
  reasonMoM: string;  // auto-populated from kode akun Klasifikasi
  reasonYoY: string;  // auto-populated from kode akun Remark
};

type RekapSheetData = {
  sheetName: string;
  headers: string[];
  originalHeaders: string[]; // for display
  amountCols: AmountCol[];
  accountColIdx: number;
  momCurrIdx: number;   // index in amountCols for MoM current
  momPrevIdx: number;   // index in amountCols for MoM previous
  yoyCurrIdx: number;   // index in amountCols for YoY current
  yoyPrevIdx: number;   // index in amountCols for YoY previous (same month last year)
  rows: RekapSheetRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
let XLSX: any = null;
const loadXLSX = async () => {
  if (!XLSX) XLSX = await import('xlsx');
  return XLSX;
};

const parseNum = (val: any): number => {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const n = Number(val.toString().replace(/\./g, '').replace(/,/g, '.'));
  return Number.isNaN(n) ? 0 : n;
};

const parseDateToPeriode = (val: any): string => {
  if (val === '' || val === null || val === undefined) return '';
  let date: Date | null = null;
  if (typeof val === 'number' && val > 40000) {
    date = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
  } else if (typeof val === 'string') {
    const s = val.trim();
    let m: RegExpMatchArray | null;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) date = new Date(+m[3], +m[1] - 1, +m[2]);
    if (!date) { m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) date = new Date(+m[3], +m[2] - 1, +m[1]); }
    if (!date) { m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) date = new Date(+m[1], +m[2] - 1, +m[3]); }
    if (!date) { m = s.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) date = new Date(+m[1], +m[2] - 1, +m[3]); }
  }
  if (!date || isNaN(date.getTime())) return String(val ?? '');
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const extractKlasifikasi = (text: string): string => {
  if (!text) return '';
  const s = String(text).trim();
  const cleaned = s
    .replace(/^(Accrue|AKRU|Amortisasi Biaya Transaksi|Amortisasi|Accrual|Amort\.?)\s+/i, '')
    .replace(/\s+\d{2}[.\-]\d{4,}.*$/, '')
    .replace(/\s+\d{2}[.\-]\d{2}$/, '')
    .trim();
  return cleaned || s;
};

const findColIdx = (headers: string[], keywords: string[]): number => {
  for (const kw of keywords) {
    const idx = headers.findIndex((h) => h.toLowerCase().includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
};

// Cached formatters — created once, reused on every render
const FMT_RP  = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const FMT_PCT = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRp  = (n: number) => FMT_RP.format(n);
const fmtPct = (n: number) => FMT_PCT.format(n) + '%';

const classifyRow = (values: any[], accountColIdx: number): RekapSheetRow['type'] => {
  if (values.every((v) => v === '' || v === null || v === undefined)) return 'empty';
  const acct = String(values[accountColIdx] ?? '').trim();

  // Explicit subtotal keyword in any text cell
  const hasSubtotalKeyword = values.some((v) =>
    /\b(total|jumlah|sub[\s\-]?total|gesamt)\b/i.test(String(v ?? '')));
  if (hasSubtotalKeyword) return 'subtotal';

  // Account ends in 4+ zeros → subtotal
  if (/\d/.test(acct) && /0{4,}$/.test(acct)) return 'subtotal';

  // No account number but row has at least one numeric value → subtotal row
  // (SAP rekap: subtotal rows often have blank account col but carry amounts)
  if (!acct || !/\d/.test(acct)) {
    const hasNumeric = values.some((v, i) => {
      if (i === accountColIdx) return false;
      if (v === '' || v === null || v === undefined) return false;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
      return !isNaN(n) && n !== 0;
    });
    return hasNumeric ? 'subtotal' : 'category';
  }

  return 'detail';
};

/**
 * Try to detect the "year" and "date" labels from a rekap header.
 * Rekap sheets often have two header rows: row 0 = year, row 1 = specific date.
 * We check if the header label looks like a date (contains month abbrev or slash-date).
 */
const parseAmountColLabel = (
  label: string,
  yearHint: string,
): { yearLabel: string; dateLabel: string; isCumulative: boolean } => {
  const isCumulative = /total|up to|s\.d\.|ytd|kumulatif/i.test(label);
  const yearMatch = label.match(/20\d{2}/);
  const yearLabel = yearMatch ? yearMatch[0] : yearHint;
  return { yearLabel, dateLabel: label, isCumulative };
};

// Pure helpers outside component — no re-creation on render
const REKAP_ROW_STYLES = {
  category: { bg: '#1F3864', text: '#ffffff', weight: '700', border: 'rgba(255,255,255,0.15)' },
  subtotal:  { bg: '#C00000', text: '#ffffff', weight: '700', border: 'rgba(255,255,255,0.2)'  },
} as const;
const rekapRowStyle = (type: RekapSheetRow['type'], ri: number) =>
  type === 'category' ? REKAP_ROW_STYLES.category
  : type === 'subtotal' ? REKAP_ROW_STYLES.subtotal
  : { bg: ri % 2 === 0 ? '#ffffff' : '#f0f4ff', text: '#374151', weight: '400', border: '#e5e7eb' };

const amtColBg = (ac: AmountCol) => {
  if (ac.isCumulative) return '#E36C09';
  const yr = ac.yearLabel.match(/20(\d{2})/);
  if (!yr) return '#244185';
  return parseInt(yr[1]) < 26 ? '#1F3864' : '#244185';
};

const KA_PAGE_SIZE   = 100;
const REKAP_PAGE_SIZE = 200;
const ADDED_KA_HEADERS = ['Periode', 'Klasifikasi', 'Remark'];

// ─── Component ────────────────────────────────────────────────────────────────
export default function FluktuasiOIPage() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheetDataList, setSheetDataList] = useState<SheetData[]>([]);
  const [rekapSheetData, setRekapSheetData] = useState<RekapSheetData | null>(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [kaPage,    setKaPage]    = useState(0);
  const [rekapPage, setRekapPage] = useState(0);

  // ── Load data from database on mount ──────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/fluktuasi?uploadedBy=system');
        if (res.ok) {
          const result = await res.json();
          if (result.success && result.data) {
            setFileName(result.data.fileName);
            setSheetDataList(result.data.sheetDataList);
            setRekapSheetData(result.data.rekapSheetData);
          }
        }
      } catch (error) {
        console.log('Tidak ada data fluktuasi sebelumnya');
      }
    };
    loadData();
  }, []);

  // ── Save data to database ──────────────────────────────────────────────────
  const saveToDatabase = async (fname: string, sheets: SheetData[], rekap: RekapSheetData | null) => {
    try {
      const res = await fetch('/api/fluktuasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: fname,
          sheetDataList: sheets,
          rekapSheetData: rekap,
          uploadedBy: 'system',
        }),
      });
      const result = await res.json();
      if (!result.success) {
        console.error('Gagal menyimpan ke database:', result.error);
      }
    } catch (error) {
      console.error('Error menyimpan ke database:', error);
    }
  };

  // ── Process file ─────────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setFileName(file.name);
    setSheetDataList([]);
    setRekapSheetData(null);
    setActiveSheetIdx(0);

    try {
      const XLSXLib = await loadXLSX();
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSXLib.read(arrayBuffer, { cellDates: false });
      const sheetNames: string[] = workbook.SheetNames || [];

      const kodeAkunSheets = sheetNames.filter((n) => /^\d+$/.test(n.trim()));
      const rekapSheetName = sheetNames.find((n) => !/^\d+$/.test(n.trim())) ?? null;

      if (kodeAkunSheets.length === 0) {
        alert('Tidak ada sheet kode akun (nama numerik) yang ditemukan.');
        return;
      }

      // ── Process kode akun sheets ──────────────────────────────────────────
      const result: SheetData[] = [];
      for (const sheetName of kodeAkunSheets) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const raw: any[][] = XLSXLib.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) continue;

        // Find header row: look for row with most non-empty text cells
        let headerRowIdx = 0;
        let maxTextCells = 0;
        for (let i = 0; i < Math.min(raw.length, 10); i++) {
          const row = raw[i];
          const textCells = row.filter((c: any) => {
            if (c === '' || c === null || c === undefined) return false;
            const s = String(c).trim();
            // Count as text if it has letters or is a typical header word
            return s.length > 0 && (!/^\d+$/.test(s) || /[A-Za-z]/.test(s));
          }).length;
          if (textCells > maxTextCells) {
            maxTextCells = textCells;
            headerRowIdx = i;
          }
        }
        
        const rawHeaders = (raw[headerRowIdx] as any[]).map((h) =>
          h !== null && h !== undefined ? String(h).trim() : '');
        const originalHeaders: string[] = rawHeaders.map((h, i) => h || `Col_${i + 1}`);
        const headers: string[] = [];
        const seen: Record<string, number> = {};
        rawHeaders.forEach((h, i) => {
          const key = h || `Col_${i + 1}`;
          if (seen[key] !== undefined) { seen[key]++; headers.push(`${key}_${seen[key]}`); }
          else { seen[key] = 0; headers.push(key); }
        });

        // ── Column detection: keyword first, then auto-detect from data ──────
        let dateColIdx = findColIdx(headers, [
          'Posting Date','Pstng Date','Posting date','Pstng.Date',
          'Document Date','Doc. Date','Doc.Date','DocDate',
          'Tanggal Posting','Tanggal Dok','Tanggal','Tgl Posting',
        ]);
        // Fallback: scan for column whose values mostly look like dates
        if (dateColIdx < 0) {
          const sampleRows = raw.slice(headerRowIdx + 1, headerRowIdx + 20);
          const isDateLike = (v: any) => {
            if (typeof v === 'number' && v > 40000 && v < 60000) return true;
            const s = String(v ?? '').trim();
            return /^\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}$/.test(s) ||
              /^\d{2}[.\-]\d{2}[.\-]\d{4}$/.test(s) ||
              /^\d{4}-\d{2}-\d{2}$/.test(s) ||
              /^\d{8}$/.test(s);
          };
          let bestDateScore = 0;
          headers.forEach((_, col) => {
            const vals = sampleRows.map((r) => r[col]).filter((v) => v !== '' && v !== null && v !== undefined);
            if (vals.length === 0) return;
            const score = vals.filter(isDateLike).length / vals.length;
            if (score > 0.5 && score > bestDateScore) { bestDateScore = score; dateColIdx = col; }
          });
        }

        let klasifikasiColIdx = findColIdx(headers, [
          'Document Header Text','Header Text','Doc. Header Text','Doc.HeaderText',
          'DocHeaderText','Header Dokumen','Deskripsi Header','Description',
          'Keterangan','Uraian','Narasi','Nama Akun',
        ]);
        // Fallback: find the text column with highest avg length (likely description)
        if (klasifikasiColIdx < 0) {
          const sampleRows = raw.slice(headerRowIdx + 1, headerRowIdx + 30);
          let bestAvg = 0;
          headers.forEach((_, col) => {
            if (col === dateColIdx) return;
            const vals = sampleRows.map((r) => String(r?.[col] ?? '').trim()).filter((v) => v.length > 0);
            if (vals.length === 0) return;
            const numericCount = vals.filter((v) => !isNaN(Number(v.replace(/[.,]/g, '')))).length;
            if (numericCount > vals.length * 0.5) return; // skip numeric cols
            const avg = vals.reduce((acc, v) => acc + v.length, 0) / vals.length;
            if (avg > bestAvg) { bestAvg = avg; klasifikasiColIdx = col; }
          });
        }

        const remarkColIdxRaw = findColIdx(headers, [
          'Assignment','Zuordnung','Reference','Ref. Doc.','Ref. document',
          'Text','Item Text','PO Text','Teks','Keterangan Item','Narasi Item',
        ]);
        const remarkColIdx = remarkColIdxRaw >= 0 && remarkColIdxRaw !== klasifikasiColIdx
          ? remarkColIdxRaw
          : klasifikasiColIdx;

        const rows: Record<string, any>[] = [];
        for (let r = headerRowIdx + 1; r < raw.length; r++) {
          const rawRow = raw[r];
          if (!rawRow || rawRow.every((c: any) => c === '' || c === null)) continue;
          const obj: Record<string, any> = {};
          headers.forEach((h, idx) => { obj[h] = rawRow[idx] ?? ''; });
          obj['__periode']     = parseDateToPeriode(dateColIdx >= 0 ? rawRow[dateColIdx] : '');
          obj['__klasifikasi'] = extractKlasifikasi(String(klasifikasiColIdx >= 0 ? rawRow[klasifikasiColIdx] : ''));
          obj['__remark']      = String(remarkColIdx >= 0 ? rawRow[remarkColIdx] : '').trim();
          rows.push(obj);
        }
        result.push({ sheetName, headers, originalHeaders, rows });
      }
      setSheetDataList(result);

      // ── Build lookup map: accountCode → { klasifikasi[], remark[] } ─────────
      const acctReasonMap: Record<string, { klasifikasi: Set<string>; remark: Set<string> }> = {};
      for (const sd of result) {
        const code = sd.sheetName.trim();
        const kSet = new Set<string>();
        const rSet = new Set<string>();
        for (const row of sd.rows) {
          const k = String(row['__klasifikasi'] ?? '').trim();
          const r = String(row['__remark'] ?? '').trim();
          if (k) kSet.add(k);
          if (r) rSet.add(r);
        }
        acctReasonMap[code] = { klasifikasi: kSet, remark: rSet };
      }

      // ── Process rekap sheet ───────────────────────────────────────────────
      let rekapData: RekapSheetData | null = null;
      if (rekapSheetName) {
        const wsR = workbook.Sheets[rekapSheetName];
        if (wsR) {
          // Read 2 header rows
          const rawR: any[][] = XLSXLib.utils.sheet_to_json(wsR, { header: 1, defval: '' });

          // Find the header section: look for 2 consecutive rows both having >=2 non-empty cells
          let hRow1 = 0, hRow2 = 1;
          for (let i = 0; i < Math.min(rawR.length - 1, 10); i++) {
            const r0 = rawR[i].filter((c: any) => c !== '' && c !== null).length;
            const r1 = rawR[i + 1].filter((c: any) => c !== '' && c !== null).length;
            if (r0 >= 2 && r1 >= 2) { hRow1 = i; hRow2 = i + 1; break; }
          }

          // If only single header row detected, use same row for both
          const topRow    = rawR[hRow1] as any[];
          const bottomRow = rawR[hRow2] as any[];

          // Build merged header labels: if top cell is non-empty use it, otherwise look up
          const lastTopLabel: string[] = [];
          const fullHeaders: string[] = [];
          const topLabels: string[]   = [];
          const bottomLabels: string[] = [];

          const maxCols = Math.max(topRow.length, bottomRow.length);
          let currentTopLabel = '';
          for (let c = 0; c < maxCols; c++) {
            const t = String(topRow[c] ?? '').trim();
            const b = String(bottomRow[c] ?? '').trim();
            if (t) currentTopLabel = t;
            topLabels.push(currentTopLabel);
            bottomLabels.push(b);
            fullHeaders.push(b || t || `Col_${c + 1}`);
          }

          // Deduplicate headers
          const originalHeaders = fullHeaders.slice(); // Keep original for display
          const headers: string[] = [];
          const seenR: Record<string, number> = {};
          fullHeaders.forEach((h, i) => {
            const key = h || `Col_${i + 1}`;
            if (seenR[key] !== undefined) { seenR[key]++; headers.push(`${key}_${seenR[key]}`); }
            else { seenR[key] = 0; headers.push(key); }
          });

          // Detect account column
          let accountColIdx = 0;
          for (let col = 0; col < headers.length; col++) {
            const samples = rawR.slice(hRow2 + 1, hRow2 + 20)
              .map((r) => String(r?.[col] ?? '').trim())
              .filter((v) => /^\d{5,}$/.test(v));
            if (samples.length >= 2) { accountColIdx = col; break; }
          }

          // Detect numeric amount columns
          const amountCols: AmountCol[] = [];
          for (let col = 0; col < headers.length; col++) {
            if (col === accountColIdx) continue;
            let numCnt = 0, nonEmpty = 0;
            for (let r = hRow2 + 1; r < Math.min(rawR.length, hRow2 + 25); r++) {
              const v = rawR[r]?.[col];
              if (v !== '' && v !== null && v !== undefined) {
                nonEmpty++;
                if (typeof v === 'number' || (!isNaN(parseNum(v)) && String(v).length > 0)) numCnt++;
              }
            }
            if (nonEmpty > 0 && numCnt / nonEmpty >= 0.4) {
              const parsed = parseAmountColLabel(headers[col], topLabels[col]);
              amountCols.push({
                colIdx: col,
                label: headers[col],
                yearLabel: topLabels[col] || parsed.yearLabel,
                dateLabel: bottomLabels[col] || headers[col],
                isCumulative: parsed.isCumulative,
              });
            }
          }

          // Determine MoM and YoY column indices within amountCols array
          // Non-cumulative cols only for point-in-time comparison
          const pointCols = amountCols.filter((c) => !c.isCumulative);
          // MoM: last two non-cumulative cols
          const momCurrIdx = amountCols.length >= 1 ? amountCols.length - 1 : 0;
          const momPrevIdx = amountCols.length >= 2 ? amountCols.length - 2 : 0;
          // YoY: last col vs first point-in-time col with same month (heuristic: first non-cumulative)
          const yoyCurrIdx = momCurrIdx;
          const yoyPrevIdx = pointCols.length >= 2
            ? amountCols.findIndex((c) => c.colIdx === pointCols[0].colIdx)
            : 0;

          // Build rows
          const rekapRows: RekapSheetRow[] = [];
          for (let r = hRow2 + 1; r < rawR.length; r++) {
            const rawRow = rawR[r] as any[];
            const values = headers.map((_, i) => rawRow?.[i] ?? '');
            const type = classifyRow(values, accountColIdx);

            const currAmtCol = amountCols[momCurrIdx];
            const prevAmtCol = amountCols[momPrevIdx];
            const yoyCurrCol = amountCols[yoyCurrIdx];
            const yoyPrevCol = amountCols[yoyPrevIdx];

            const curr    = currAmtCol ? parseNum(rawRow?.[currAmtCol.colIdx]) : 0;
            const prev    = prevAmtCol ? parseNum(rawRow?.[prevAmtCol.colIdx]) : 0;
            const yoyCurr = yoyCurrCol ? parseNum(rawRow?.[yoyCurrCol.colIdx]) : 0;
            const yoyPrev = yoyPrevCol ? parseNum(rawRow?.[yoyPrevCol.colIdx]) : 0;

            const gapMoM = curr - prev;
            const pctMoM = prev === 0 ? 0 : (gapMoM / Math.abs(prev)) * 100;
            const gapYoY = yoyCurr - yoyPrev;
            const pctYoY = yoyPrev === 0 ? 0 : (gapYoY / Math.abs(yoyPrev)) * 100;

            // Auto-populate reasons from kode akun lookup
            const acctCode = String(values[accountColIdx] ?? '').trim();
            const acctEntry = acctReasonMap[acctCode];
            const reasonMoM = acctEntry ? [...acctEntry.klasifikasi].join('; ') : '';
            const reasonYoY = acctEntry ? [...acctEntry.remark].join('; ') : '';

            rekapRows.push({ values, type, gapMoM, pctMoM, gapYoY, pctYoY, reasonMoM, reasonYoY });
          }

          rekapData = {
            sheetName: rekapSheetName,
            headers,
            originalHeaders,
            amountCols,
            accountColIdx,
            momCurrIdx,
            momPrevIdx,
            yoyCurrIdx,
            yoyPrevIdx,
            rows: rekapRows,
          };
          setRekapSheetData(rekapData);
        }
      }

      // ── Save to database ───────────────────────────────────────────────────
      await saveToDatabase(file.name, result, rekapData);

    } catch (err: any) {
      console.error(err);
      alert('Gagal membaca file: ' + (err?.message || err));
      setFileName('');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Download (via API → ExcelJS with full formatting) ────────────────────────
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!sheetDataList.length && !rekapSheetData) {
      alert('Belum ada data. Upload file terlebih dahulu.');
      return;
    }
    setIsDownloading(true);
    try {
      const res = await fetch('/api/fluktuasi/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, sheetDataList, rekapSheetData }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const blob = await res.blob();
      const base = fileName.replace(/\.[^.]+$/, '') || 'Fluktuasi_OI';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}_HASIL.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert('Gagal download: ' + (err?.message || err));
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Derived / memoized values ──────────────────────────────────────────────
  const activeSheet = useMemo(() => sheetDataList[activeSheetIdx] ?? null, [sheetDataList, activeSheetIdx]);

  // Paginated kode-akun rows
  const kaRows = useMemo(() => activeSheet?.rows ?? [], [activeSheet]);
  const kaTotalPages = Math.ceil(kaRows.length / KA_PAGE_SIZE);
  const kaPageRows   = useMemo(() => kaRows.slice(kaPage * KA_PAGE_SIZE, (kaPage + 1) * KA_PAGE_SIZE), [kaRows, kaPage]);

  // Precomputed amountCols set for O(1) lookup per cell
  const amtColMap = useMemo(() => {
    const m = new Map<number, AmountCol>();
    rekapSheetData?.amountCols.forEach((ac) => m.set(ac.colIdx, ac));
    return m;
  }, [rekapSheetData]);

  // Paginated rekap rows (skip empty)
  const rekapDisplayRows = useMemo(() =>
    (rekapSheetData?.rows ?? []).filter((r) => r.type !== 'empty'),
  [rekapSheetData]);
  const rekapTotalPages = Math.ceil(rekapDisplayRows.length / REKAP_PAGE_SIZE);
  const rekapPageRows   = useMemo(() =>
    rekapDisplayRows.slice(rekapPage * REKAP_PAGE_SIZE, (rekapPage + 1) * REKAP_PAGE_SIZE),
  [rekapDisplayRows, rekapPage]);

  // Reset pages when switching tabs
  const switchTab = useCallback((idx: number) => { setActiveSheetIdx(idx); setKaPage(0); }, []);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      <div className="flex-1 bg-gray-50 lg:ml-64 overflow-x-hidden">
        <Header
          title="Fluktuasi Other Income / Expenses"
          subtitle="Upload file Excel multi-sheet → sistem tambah kolom GAP MoM, MoM%, Reason MoM, GAP YoY, YoY%, Reason YoY"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />

        <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6">

          {/* ── Upload Card ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-lg p-5 border border-gray-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <FileSpreadsheet className="text-indigo-600" size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Upload File Fluktuasi</h2>
                  <p className="text-xs sm:text-sm text-gray-500">
                    File Excel: sheet kode akun (nama angka) + 1 sheet Rekap (nama teks)
                  </p>
                </div>
              </div>
              <button
                onClick={handleDownload}
                disabled={isProcessing || isDownloading || (!sheetDataList.length && !rekapSheetData)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-sm text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDownloading
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Menyiapkan…</>
                  : <><Download size={16} />Download Excel Hasil</>}
              </button>
            </div>

            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
              <Upload className="text-gray-400 mb-2" size={28} />
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-700">{fileName || 'Klik untuk upload'}</span>{' '}
                {!fileName && 'atau drag & drop'}
              </p>
              <p className="text-xs text-gray-400 mt-1">.xlsx / .xls</p>
              <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} disabled={isProcessing} />
            </label>

            {isProcessing && (
              <div className="flex items-center justify-center mt-4 gap-3 text-sm text-gray-600">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600" />
                Memproses file…
              </div>
            )}
          </div>

          {/* ── Legend ───────────────────────────────────────────────────── */}
          {(sheetDataList.length > 0 || rekapSheetData) && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded" style={{ backgroundColor: '#4472C4' }} />
                Kolom asli Excel
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded" style={{ backgroundColor: '#C00000' }} />
                Kolom tambahan sistem / baris subtotal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded" style={{ backgroundColor: '#1F3864' }} />
                Header kategori
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded" style={{ backgroundColor: '#E36C09' }} />
                Kolom kumulatif
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded" style={{ backgroundColor: '#FFC000' }} />
                GAP / % kolom sistem
              </span>
            </div>
          )}

          {/* ── Kode Akun Tabs + Table ────────────────────────────────────── */}
          {sheetDataList.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center border-b border-gray-200 bg-gray-50">
                <button className="flex-shrink-0 px-2 py-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  disabled={activeSheetIdx === 0} onClick={() => switchTab(Math.max(0, activeSheetIdx - 1))}>
                  <ChevronLeft size={16} />
                </button>
                <div className="flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {sheetDataList.map((sd, idx) => (
                    <button key={sd.sheetName} onClick={() => switchTab(idx)}
                      className={`flex-shrink-0 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                        idx === activeSheetIdx
                          ? 'border-blue-600 text-blue-700 bg-white'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                      }`}>
                      {sd.sheetName}
                    </button>
                  ))}
                </div>
                <button className="flex-shrink-0 px-2 py-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  disabled={activeSheetIdx === sheetDataList.length - 1}
                  onClick={() => switchTab(Math.min(sheetDataList.length - 1, activeSheetIdx + 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>

              {activeSheet && (
                <>
                  <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-500 flex flex-wrap items-center gap-3">
                    <span>Kode Akun: <span className="font-semibold text-gray-800">{activeSheet.sheetName}</span></span>
                    <span><span className="font-semibold text-gray-800">{kaRows.length}</span> baris</span>
                    <span><span className="font-semibold" style={{ color: '#4472C4' }}>{activeSheet.headers.length}</span> kolom asli + <span className="font-semibold" style={{ color: '#C00000' }}>3</span> kolom sistem</span>
                    {kaTotalPages > 1 && (
                      <span className="ml-auto flex items-center gap-1">
                        <button onClick={() => setKaPage((p) => Math.max(0, p - 1))} disabled={kaPage === 0}
                          className="px-2 py-0.5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-30">‹</button>
                        <span className="text-gray-500">Hal {kaPage + 1}/{kaTotalPages}</span>
                        <button onClick={() => setKaPage((p) => Math.min(kaTotalPages - 1, p + 1))} disabled={kaPage === kaTotalPages - 1}
                          className="px-2 py-0.5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-30">›</button>
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead>
                        <tr>
                          {activeSheet.headers.map((h, idx) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-white whitespace-nowrap"
                              style={{ backgroundColor: '#4472C4', border: '1px solid #3a62a8' }}>
                              {activeSheet.originalHeaders?.[idx] ?? h}
                            </th>
                          ))}
                          {ADDED_KA_HEADERS.map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-white whitespace-nowrap"
                              style={{ backgroundColor: '#C00000', border: '1px solid #900000' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {kaPageRows.map((row, ri) => {
                          const globalRi = kaPage * KA_PAGE_SIZE + ri;
                          const rowBg = globalRi % 2 === 0 ? '#ffffff' : '#eff6ff';
                          const addBg = globalRi % 2 === 0 ? '#fff5f5' : '#fff0f0';
                          return (
                          <tr key={ri} style={{ backgroundColor: rowBg }}>
                            {activeSheet.headers.map((h) => (
                              <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap"
                                style={{ border: '1px solid #e5e7eb' }}>{row[h] ?? ''}</td>
                            ))}
                            <td className="px-3 py-1.5 font-medium whitespace-nowrap text-gray-800"
                              style={{ border: '1px solid #fecaca', backgroundColor: addBg }}>
                              {row['__periode'] ?? ''}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-800"
                              style={{ border: '1px solid #fecaca', backgroundColor: addBg }}>
                              {row['__klasifikasi'] ?? ''}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-800"
                              style={{ border: '1px solid #fecaca', backgroundColor: addBg }}>
                              {row['__remark'] ?? ''}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Rekap Sheet Table ─────────────────────────────────────────── */}
          {rekapSheetData && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between"
                style={{ background: 'linear-gradient(to right,#1F3864,#2e4d8a)' }}>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Rekap — {rekapSheetData.sheetName}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: '#c7d4f0' }}>
                    {rekapSheetData.rows.filter((r) => r.type === 'detail').length} akun detail
                    &ensp;·&ensp;
                    <span style={{ color: '#fca5a5' }}>6 kolom tambahan sistem</span>
                    &ensp;(GAP MoM · MoM% · Reason MoM · GAP YoY · YoY% · Reason YoY)
                  </p>
                </div>
              </div>

                  {rekapTotalPages > 1 && (
                    <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500">
                      <span><span className="font-semibold text-gray-800">{rekapDisplayRows.length}</span> baris</span>
                      <span className="flex items-center gap-1">
                        <button onClick={() => setRekapPage((p) => Math.max(0, p - 1))} disabled={rekapPage === 0}
                          className="px-2 py-0.5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-30">‹</button>
                        <span>Hal {rekapPage + 1}/{rekapTotalPages}</span>
                        <button onClick={() => setRekapPage((p) => Math.min(rekapTotalPages - 1, p + 1))} disabled={rekapPage === rekapTotalPages - 1}
                          className="px-2 py-0.5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-30">›</button>
                      </span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                <table className="min-w-full text-[11px] border-collapse">
                  <thead>
                    {/* ── Row 1: year labels + group labels ── */}
                    <tr>
                      {rekapSheetData.headers.map((_, ci) => {
                        const ac = amtColMap.get(ci);
                        const bg = ac ? amtColBg(ac) : '#1F3864';
                        const label = ac ? ac.yearLabel : '';
                        return (
                          <th key={ci} className="px-3 py-1 text-center text-white text-[10px] font-bold whitespace-nowrap"
                            style={{ backgroundColor: bg, border: '1px solid rgba(255,255,255,0.15)' }}>
                            {label}
                          </th>
                        );
                      })}
                      {/* MoM group */}
                      <th className="px-3 py-1 text-center text-black text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM</th>
                      <th className="px-3 py-1 text-center text-black text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM</th>
                      <th className="px-3 py-1 text-center text-white text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>Reason MoM</th>
                      {/* YoY group */}
                      <th className="px-3 py-1 text-center text-black text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY</th>
                      <th className="px-3 py-1 text-center text-black text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY</th>
                      <th className="px-3 py-1 text-center text-white text-[10px] font-bold whitespace-nowrap"
                        style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>Reason YoY</th>
                    </tr>
                    {/* ── Row 2: date labels + sub-labels ── */}
                    <tr>
                      {rekapSheetData.headers.map((h, ci) => {
                        const ac = amtColMap.get(ci);
                        const bg = ac ? amtColBg(ac) : '#244185';
                        const label = ac ? ac.dateLabel : (rekapSheetData.originalHeaders?.[ci] ?? h);
                        return (
                          <th key={ci} className="px-3 py-1.5 text-center text-white text-[10px] font-semibold whitespace-nowrap"
                            style={{ backgroundColor: bg, border: '1px solid rgba(255,255,255,0.15)' }}>
                            {label}
                          </th>
                        );
                      })}
                      <th className="px-3 py-1.5 text-center text-black text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>GAP<br/>MoM</th>
                      <th className="px-3 py-1.5 text-center text-black text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM<br/>%</th>
                      <th className="px-3 py-1.5 text-center text-white text-[10px] font-semibold"
                        style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)', minWidth: '220px' }}></th>
                      <th className="px-3 py-1.5 text-center text-black text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>GAP<br/>YoY</th>
                      <th className="px-3 py-1.5 text-center text-black text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY<br/>%</th>
                      <th className="px-3 py-1.5 text-center text-white text-[10px] font-semibold"
                        style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)', minWidth: '220px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rekapPageRows.map((row, ri) => {
                      const globalRi = rekapPage * REKAP_PAGE_SIZE + ri;
                      const s = rekapRowStyle(row.type, globalRi);
                      const isSpecial = row.type === 'category' || row.type === 'subtotal';
                      const gapColor = (v: number) =>
                        isSpecial ? '#fff' : v < 0 ? '#b91c1c' : v > 0 ? '#15803d' : '#374151';
                      return (
                        <tr key={ri}>
                          {rekapSheetData.headers.map((_, ci) => {
                            const ac = amtColMap.get(ci);
                            const isAmt = !!ac;
                            return (
                              <td key={ci} className="px-3 py-1.5 whitespace-nowrap"
                                style={{
                                  backgroundColor: s.bg,
                                  color: s.text,
                                  fontWeight: s.weight,
                                  border: `1px solid ${s.border}`,
                                  textAlign: isAmt ? 'right' : 'left',
                                }}>
                                {isAmt
                                  ? (row.values[ci] !== '' && row.values[ci] !== null
                                      ? fmtRp(parseNum(row.values[ci]))
                                      : '')
                                  : String(row.values[ci] ?? '')}
                              </td>
                            );
                          })}
                          {/* GAP MoM */}
                          <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                              color: gapColor(row.gapMoM),
                              fontWeight: s.weight,
                              border: '1px solid #fde68a',
                            }}>
                            {row.values.some((v) => v !== '') ? fmtRp(row.gapMoM) : ''}
                          </td>
                          {/* MoM % */}
                          <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                              color: gapColor(row.pctMoM),
                              fontWeight: s.weight,
                              border: '1px solid #fde68a',
                            }}>
                            {row.values.some((v) => v !== '') ? fmtPct(row.pctMoM) : ''}
                          </td>
                          {/* Reason MoM */}
                          <td className="px-3 py-1.5"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#f0f3ff' : '#e8ecff',
                              color: isSpecial ? '#fff' : '#374151',
                              border: '1px solid #c7d2fe',
                              minWidth: '220px',
                              fontStyle: !isSpecial && !row.reasonMoM ? 'italic' : 'normal',
                              fontWeight: s.weight,
                            }}>
                            {isSpecial ? '' : (row.reasonMoM || '—')}
                          </td>
                          {/* GAP YoY */}
                          <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                              color: gapColor(row.gapYoY),
                              fontWeight: s.weight,
                              border: '1px solid #fde68a',
                            }}>
                            {row.values.some((v) => v !== '') ? fmtRp(row.gapYoY) : ''}
                          </td>
                          {/* YoY % */}
                          <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                              color: gapColor(row.pctYoY),
                              fontWeight: s.weight,
                              border: '1px solid #fde68a',
                            }}>
                            {row.values.some((v) => v !== '') ? fmtPct(row.pctYoY) : ''}
                          </td>
                          {/* Reason YoY */}
                          <td className="px-3 py-1.5"
                            style={{
                              backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#f0f3ff' : '#e8ecff',
                              color: isSpecial ? '#fff' : '#374151',
                              border: '1px solid #c7d2fe',
                              minWidth: '220px',
                              fontStyle: !isSpecial && !row.reasonYoY ? 'italic' : 'normal',
                              fontWeight: s.weight,
                            }}>
                            {isSpecial ? '' : (row.reasonYoY || '—')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
