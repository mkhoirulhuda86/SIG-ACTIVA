'use client';

import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { Upload, FileSpreadsheet, Download, ChevronLeft, ChevronRight, Trash2, ChevronDown, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import { gsap } from 'gsap';
import { animate as animeAnimate, stagger as animeStagger } from 'animejs';
import { Progress } from '@/app/components/ui/progress';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Badge } from '@/app/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────
type SheetData = {
  sheetName: string;
  headers: string[];
  originalHeaders: string[]; // for display
  rows: Record<string, any>[];
  klasifikasiColIdx?: number; // index into headers for source-text column
  docnoColIdx?: number;       // index into headers for document-number column
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
  gapYtD: number;
  pctYtD: number;
  ytdCurrV: number;   // raw YtD value for current-year endpoint (for display column)
  ytdPrevV: number;   // raw YtD value for prev-year endpoint (for display column)
  reasonMoM: string;  // auto-populated from kode akun Klasifikasi
  reasonYoY: string;  // auto-populated from kode akun Remark
  reasonYtD: string;  // reason for YtD variance
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
  ytdCurrColIdxs: number[]; // amountCols indices for current-year YtD range (Jan→currMo)
  ytdPrevColIdxs: number[]; // amountCols indices for prev-year YtD range (Jan→currMo)
  ytdLabel: string;         // e.g. "Jan-Mar '26 vs Jan-Mar '25"
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

// Match text with keywords from database
// Parse natural language keyword input
const parseNaturalKeyword = (input: string): { keyword: string; type: string; result: string; priority: number; accountCodes: string; sourceColumn: string } | null => {
  if (!input.trim()) return null;

  const text = input.toLowerCase();
  const original = input;

  // ── Extract sourceColumn: "by kolom X" / "cek di kolom X" / "check column X"
  // Distinct from col: mode — this just overrides which column the keyword text is matched against
  let sourceColumn = '';
  const srcColM = original.match(
    /(?:by\s+kolom|cek\s+(?:di\s+)?kolom|check\s+(?:in\s+)?column)\s+["']?([^\s"',;:!?\n]+)["']?/i
  );
  if (srcColM) {
    sourceColumn = srcColM[1].trim();
  }

  // ── Extract accountCodes: "di akun '12345'" / "di akun 12345,67890" / "berlaku akun 62301 62302"
  let accountCodes = '';
  const acctM = original.match(
    /(?:hanya\s+)?(?:berlaku\s+)?(?:di\s+)?akun\s+["']?([\d][\d,\s]*)["\'$]/i
  ) ?? original.match(
    /(?:hanya\s+)?(?:berlaku\s+)?di\s+akun\s+["']?([\d][\d,\s]*)/i
  );
  if (acctM) {
    accountCodes = acctM[1]
      .trim()
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => /^\d{5,}$/.test(s))
      .join(',');
  }

  // ── Extract result/output (text in quotes after "berisi", "maka berisi", etc.)
  let resultMatch = original.match(/(?:berisi|is|result|output|hasil)\s*["']([^"']+)["']/i);
  if (!resultMatch) resultMatch = original.match(/(?:berisi|is)\s+["']?([\w\s]+?)["']?$/i);

  // ── Detect output type (klasifikasi vs remark)
  let type = 'klasifikasi';
  if (text.includes('remark') || text.includes('kolom ae')) type = 'remark';
  else if (text.includes('klasifikasi') || text.includes('kolom ad')) type = 'klasifikasi';

  // ── Extract priority if mentioned
  let priority = 5;
  const prioM = text.match(/priority\s*(\d+)/i);
  if (prioM) priority = parseInt(prioM[1]);

  // ── NOT mode: "jika tidak ada/terdapat kata 'K3' atau 'SLA' maka berisi 'Denda'"
  // Trigger: "tidak ada", "tidak terdapat", "tidak mengandung", "tanpa kata", "kecuali"
  const isNotMode = /(?:jika\s+)?(?:tidak\s+(?:ada|terdapat|mengandung)|tanpa\s+kata|kecuali)/i.test(text);
  if (isNotMode && resultMatch) {
    const quotedWords = [...original.matchAll(/["']([^"']+)["']/g)].map(m => m[1].trim());
    const resultVal = resultMatch[1].trim();
    const exclusions = quotedWords.filter(w => w.toLowerCase() !== resultVal.toLowerCase());
    if (exclusions.length > 0) {
      return { keyword: `not:${exclusions.join(',')}`, type, result: resultVal, priority, accountCodes, sourceColumn };
    }
    const bareM = original.match(/(?:kata|text|teks)\s+([\w\s,\/|]+?)(?:\s+maka|\s+berisi|$)/i);
    if (bareM) {
      const words = bareM[1].trim().split(/\s*(?:,|atau|or|dan|and|\/|\|)\s*/).filter(Boolean);
      if (words.length > 0) {
        return { keyword: `not:${words.join(',')}`, type, result: resultVal, priority, accountCodes, sourceColumn };
      }
    }
  }

  // ── Regex extract mode: "diambil dari kata 'X' dan nomor/angka/kode aset"
  // Trigger: "diambil dari", "ambil dari", "ekstrak", "extract"
  // Result is dynamic ({match}), so result left empty
  const isExtractMode = /(?:diambil\s+dari|ambil\s+dari|ekstrak\s+dari?|extract)/i.test(text);
  if (isExtractMode) {
    // Collect all quoted tokens
    const allQuoted = [...original.matchAll(/["']([^"']+)["']/g)].map(m => m[1].trim());
    // Anchor word = first quoted token that looks like a word prefix (not a column name or result)
    // Skip if it's a known column reference like 'Text', 'P', 'AD'
    const skipTokens = ['text', 'p', 'ad', 'ae', 'kolom', 'klasifikasi', 'remark'];
    const anchor = allQuoted.find(w => !skipTokens.includes(w.toLowerCase()));
    if (anchor) {
      const hasNumber = /(?:nomor|angka|kode|aset|number|digit|\d)/.test(text);
      const hasFraction = /(?:karakter|huruf|kata|word|\\w)/.test(text);
      const suffix = hasNumber ? '\\d+' : hasFraction ? '\\w+' : '\\S+';
      return { keyword: `regex:${anchor} ${suffix}`, type, result: '', priority, accountCodes, sourceColumn };
    }
  }

  // ── Regex mode: "jika teks cocok pola 'RoU \d+' maka berisi 'RoU Aset'"
  // Trigger: "cocok pola", "cocok dengan pola", "match pola", "regex", "pola regex"
  const isRegexMode = /(?:cocok\s+(?:dengan\s+)?pola|match\s+pola|pola\s+regex|regex\s*:?\s*['"\\])/i.test(text);
  if (isRegexMode) {
    // Extract pattern from quotes
    const patternM = original.match(/(?:cocok\s+(?:dengan\s+)?pola|match\s+pola|pola\s+regex|regex)\s*:?\s*["']([^"']+)["']/i);
    if (patternM) {
      const pattern = patternM[1].trim();
      const result = resultMatch ? resultMatch[1].trim() : '';
      return { keyword: `regex:${pattern}`, type, result, priority, accountCodes, sourceColumn };
    }
  }

  // ── DocNo mode: "jika nomor dokumen / no dok / belegnummer diawali/= X maka berisi Y"
  const docnoM = original.match(
    /(?:nomor\s+dokumen|no\.?\s*dok(?:umen)?|doc(?:ument)?\s*no\.?|belegnummer)\s+(?:diawali|=|starts?\s*with|adalah|berisi|sama\s+dengan)\s+["']?([\w\d\*]+)["']?/i
  );
  if (docnoM && resultMatch) {
    const val = docnoM[1].replace(/\*$/, '');
    return { keyword: `docno:${val}`, type, result: resultMatch[1].trim(), priority, accountCodes, sourceColumn };
  }

  // ── Col mode: "jika kolom X diawali/mengandung/= Y maka berisi Z"
  // Support: "By kolom 'Document No.', jika nilainya diawali 18 maka klasifikasi berisi ..."
  const colM = original.match(
    /(?:jika\s+)?(?:di\s+)?kolom\s+["']?(.+?)["']?\s+(?:(?:jika\s+)?nilainya?\s+)?(?:diawali|mengandung|berisi[^\s]|sama\s*dengan|=|startswith|contains|\*)\s+["']?([\w\d\*\-\.\/ ]+?)["']?(?:\s|$|maka)/i
  );
  if (colM && resultMatch) {
    const colName = colM[1].trim();
    const colVal  = colM[2].trim();
    const opText  = colM[0].toLowerCase();
    const isSW    = /diawali|startswith/.test(opText);
    const isContains = /mengandung|contains/.test(opText);
    const pattern = isSW ? `${colVal}*` : isContains ? `*${colVal}*` : colVal;
    // Avoid matching header text columns (kolom P/AD/AE) being treated as col:
    const skipCols = ['p', 'ad', 'ae', 'header', 'text', 'klasifikasi', 'remark', 'keterangan', 'uraian'];
    if (!skipCols.includes(colName.toLowerCase())) {
      return { keyword: `col:${colName}:${pattern}`, type, result: resultMatch[1].trim(), priority, accountCodes, sourceColumn };
    }
  }

  // ── Normal text mode: "jika ada text 'X' maka berisi 'Y'"
  let keywordMatch = original.match(/(?:jika ada text|text|keyword)\s*["']([^"']+)["']/i);
  if (!keywordMatch) keywordMatch = original.match(/(?:jika ada text|text)\s+([\w\s]+?)\s+(?:maka|then)/i);

  if (keywordMatch && resultMatch) {
    return { keyword: keywordMatch[1].trim(), type, result: resultMatch[1].trim(), priority, accountCodes, sourceColumn };
  }
  if (keywordMatch) {
    return { keyword: keywordMatch[1].trim(), type, result: keywordMatch[1].trim(), priority, accountCodes, sourceColumn };
  }

  return null;
};

const matchKeywords = (text: string, keywords: Keyword[], type: string, docno?: string, rowData?: Record<string, any>): string => {
  if (!keywords.length) return '';
  const textStr = String(text ?? '').trim();
  const textLower = textStr.toLowerCase();
  const docnoStr = String(docno ?? '').trim();

  // For klasifikasi: collect ALL matching results (deduplicated, ordered by priority)
  // For remark: return only first match (legacy behaviour)
  const collectAll = type === 'klasifikasi';

  // Filter by type and sort by priority (highest first)
  const relevantKeywords = keywords
    .filter((kw) => kw.type === type)
    .sort((a, b) => b.priority - a.priority);

  // Separate positive (including docno/col) and NOT keywords
  const positiveKeywords = relevantKeywords.filter(kw => !kw.keyword.toLowerCase().startsWith('not:'));
  const notKeywords = relevantKeywords.filter(kw => kw.keyword.toLowerCase().startsWith('not:'));

  // ── Helper: resolve effective text for a keyword (sourceColumn overrides default text)
  const getEffText = (kw: Keyword): { str: string; lower: string } => {
    const sc = (kw.sourceColumn ?? '').trim();
    if (sc && rowData) {
      const exactKey = Object.keys(rowData).find(k => k === sc);
      const ciKey    = exactKey ?? Object.keys(rowData).find(k => k.toLowerCase() === sc.toLowerCase());
      const val = ciKey ? String(rowData[ciKey] ?? '').trim() : '';
      if (val !== '') return { str: val, lower: val.toLowerCase() };
    }
    return { str: textStr, lower: textLower };
  };

  const collected = new Set<string>();

  const addResult = (result: string): boolean => {
    const r = (result ?? '').trim();
    if (!r) return false;
    collected.add(r);
    // For remark (single result), signal to stop after first match
    return !collectAll;
  };

  // ── Pass 1: positive / regex / docno / col keywords (checked in priority order)
  for (const kw of positiveKeywords) {
    const kwLower = kw.keyword.toLowerCase();

    // ── Col mode: match against any column by header name
    if (kwLower.startsWith('col:')) {
      if (!rowData) continue;
      const withoutPrefix = kw.keyword.slice(4);
      const colonIdx = withoutPrefix.indexOf(':');
      if (colonIdx < 0) continue;
      const colName = withoutPrefix.slice(0, colonIdx).trim();
      const pattern  = withoutPrefix.slice(colonIdx + 1).trim();
      const colValue = (() => {
        const exactKey = Object.keys(rowData).find(k => k === colName);
        if (exactKey !== undefined) return String(rowData[exactKey] ?? '').trim();
        const ciKey = Object.keys(rowData).find(k => k.toLowerCase() === colName.toLowerCase());
        return ciKey ? String(rowData[ciKey] ?? '').trim() : '';
      })();
      if (!colValue) continue;
      let matched = false;
      if (pattern.toLowerCase().startsWith('regex:')) {
        try { const re = new RegExp(pattern.slice(6).trim(), 'i'); matched = re.test(colValue); }
        catch (e) { console.warn('Invalid col regex:', kw.keyword); }
      } else if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.length > 2) {
        matched = colValue.toLowerCase().includes(pattern.slice(1, -1).toLowerCase());
      } else if (pattern.endsWith('*')) {
        matched = colValue.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
      } else if (pattern.startsWith('*')) {
        matched = colValue.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
      } else {
        matched = colValue.toLowerCase().includes(pattern.toLowerCase());
      }
      if (matched && addResult(kw.result || colValue)) return [...collected].join('; ');
      continue;
    }

    // ── DocNo mode
    if (kwLower.startsWith('docno:')) {
      if (!docnoStr) continue;
      const pattern = kw.keyword.slice(6).trim();
      if (pattern.toLowerCase().startsWith('regex:')) {
        try {
          const regex = new RegExp(pattern.slice(6).trim(), 'i');
          if (regex.test(docnoStr) && addResult(kw.result)) return [...collected].join('; ');
        } catch (e) { console.warn('Invalid docno regex:', kw.keyword); }
      } else {
        if (docnoStr.startsWith(pattern) && addResult(kw.result)) return [...collected].join('; ');
      }
      continue;
    }

    // ── Regex / Pattern mode
    if (kwLower.startsWith('regex:')) {
      const { str: effStr } = getEffText(kw);
      try {
        const pattern = kw.keyword.slice(6).trim();
        const regex = new RegExp(pattern, 'i');
        const match = effStr.match(regex);
        if (match) {
          let result = kw.result;
          if (!result || result.trim() === '{match}') result = match[0];
          else {
            for (let i = 1; i < match.length; i++) result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), match[i] ?? '');
            result = result.replace(/\{match\}/gi, match[0]);
          }
          if (addResult(result)) return [...collected].join('; ');
        }
      } catch (e) { console.warn('Invalid regex pattern:', kw.keyword); }
      continue;
    }

    // ── Normal text includes matching
    const { lower: effLower } = getEffText(kw);
    if (effLower.includes(kw.keyword.toLowerCase())) {
      if (addResult(kw.result)) return [...collected].join('; ');
    }
  }

  if (collected.size > 0) return [...collected].join('; ');

  // ── Pass 2: NOT keywords (only if no positive match)
  for (const kw of notKeywords) {
    const { lower: effLower } = getEffText(kw);
    const exclusions = kw.keyword.slice(4).trim().split(/[,|]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const hasExcluded = exclusions.some(excl => effLower.includes(excl));
    if (!hasExcluded) {
      return kw.result;
    }
  }

  return '';
};

const findColIdx = (headers: string[], keywords: string[]): number => {
  for (const kw of keywords) {
    const idx = headers.findIndex((h) => h.toLowerCase().includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
};

/** Detect the main "amount" column in a kode-akun sheet */
const findAmountColIdx = (
  headers: string[],
  raw: any[][],
  headerRowIdx: number,
  excludeCols: number[],
): number => {
  // Priority 1: known SAP / ID amount column names
  const amountKeywords = [
    'Amount in LC', 'Amt in loc.cur', 'LC Amount', 'Amount in Local',
    'Betrag in HW', 'Betrag HW', 'Net Amount', 'Net amount',
    'Nilai LC', 'Nilai', 'Amount', 'Jumlah', 'Total',
  ];
  const byLabel = findColIdx(headers, amountKeywords);
  if (byLabel >= 0 && !excludeCols.includes(byLabel)) return byLabel;

  // Priority 2: numeric column with highest avg absolute value (likely amounts > doc-nos)
  const sampleRows = raw.slice(headerRowIdx + 1, Math.min(raw.length, headerRowIdx + 40));
  let bestScore = -1;
  let bestCol   = -1;
  headers.forEach((_, col) => {
    if (excludeCols.includes(col)) return;
    const vals = sampleRows.map((r) => r[col]).filter((v) => v !== '' && v !== null && v !== undefined);
    if (vals.length === 0) return;
    const nums = vals.map((v) => parseNum(v));
    const nonZero = nums.filter((v) => v !== 0).length;
    if (nonZero < vals.length * 0.3) return;
    const avgAbs = nums.reduce((s, v) => s + Math.abs(v), 0) / nums.length;
    // Amounts in SAP are typically > 100; doc numbers are large but don't mix positive/negative
    const hasNeg = nums.some((v) => v < 0);
    const score  = nonZero / vals.length * (avgAbs > 100 ? Math.log10(avgAbs) : 0) * (hasNeg ? 1.5 : 1);
    if (score > bestScore) { bestScore = score; bestCol = col; }
  });
  return bestCol;
};

/** Type used for DB-persisted account-period aggregates */
type AkunPeriodeRecord = {
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi: string;
  remark: string;
};

/**
 * Compute which amountCols indices belong to the current-year YtD range
 * (Jan through currMo) and the same range in the previous year.
 * Works for both DB records (label = "YYYY.MM") and Excel headers (yearLabel + dateLabel).
 */
const buildYtdColIdxs = (
  amountCols: AmountCol[],
  currAmtColIdx: number,
): { currIdxs: number[]; prevIdxs: number[]; label: string } => {
  const currAC = amountCols[currAmtColIdx];
  if (!currAC) return { currIdxs: [], prevIdxs: [], label: '' };
  const currYearStr = currAC.yearLabel.match(/20\d{2}/)?.[0] ?? '';
  const prevYearStr = currYearStr ? String(parseInt(currYearStr) - 1) : '';
  if (!currYearStr || !prevYearStr) return { currIdxs: [], prevIdxs: [], label: '' };

  const MONTH_MAP: Record<string, number> = {
    jan:1, feb:2, mar:3, apr:4, mei:5, may:5, jun:6, jul:7,
    aug:8, agu:8, sep:9, oct:10, okt:10, nov:11, dec:12, des:12,
  };
  const getMo = (ac: AmountCol): number => {
    // DB label format: "YYYY.MM"
    const dbM = ac.label.match(/^20\d{2}\.(\d{2})$/);
    if (dbM) return parseInt(dbM[1]);
    // Excel: scan dateLabel + label for month abbreviation
    const text = (ac.dateLabel + ' ' + ac.label).toLowerCase();
    for (const [k, v] of Object.entries(MONTH_MAP)) {
      if (new RegExp(`\\b${k}\\b`).test(text)) return v;
    }
    return 0;
  };

  const currMo = getMo(currAC);
  if (currMo === 0) return { currIdxs: [], prevIdxs: [], label: '' };

  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const endMoLabel = MONTHS_SHORT[currMo - 1] ?? String(currMo);
  const label = currMo === 1
    ? `Jan '${currYearStr.slice(2)} vs Jan '${prevYearStr.slice(2)}`
    : `Jan-${endMoLabel} '${currYearStr.slice(2)} vs Jan-${endMoLabel} '${prevYearStr.slice(2)}`;

  // ── Option A: use existing cumulative ("Up to" / "Total Up to") columns directly ──
  // These already represent the Jan→currMo sum; use the LAST one per year (most recent).
  let cumulCurrIdx = -1;
  let cumulPrevIdx = -1;
  for (let i = 0; i < amountCols.length; i++) {
    const ac = amountCols[i];
    if (!ac.isCumulative) continue;
    const yr = ac.yearLabel.match(/20\d{2}/)?.[0] ?? '';
    if (yr === currYearStr) cumulCurrIdx = i;      // last cumulative col for curr year
    else if (yr === prevYearStr) cumulPrevIdx = i; // last cumulative col for prev year
  }
  if (cumulCurrIdx >= 0 && cumulPrevIdx >= 0) {
    return { currIdxs: [cumulCurrIdx], prevIdxs: [cumulPrevIdx], label };
  }

  // ── Option B: sum point-in-time monthly columns Jan → currMo ─────────────
  const currIdxs: number[] = [];
  const prevIdxs: number[] = [];
  for (let i = 0; i < amountCols.length; i++) {
    const ac = amountCols[i];
    if (ac.isCumulative) continue;
    const mo = getMo(ac);
    if (mo === 0 || mo > currMo) continue;
    const yr = ac.yearLabel.match(/20\d{2}/)?.[0] ?? '';
    if (yr === currYearStr) currIdxs.push(i);
    else if (yr === prevYearStr) prevIdxs.push(i);
  }

  return { currIdxs, prevIdxs, label };
};

/** Build a synthetic RekapSheetData from a list of account-periode records */
const buildRekapFromAkunPeriodes = (
  records: AkunPeriodeRecord[],
): RekapSheetData => {
  // 1. All unique sorted periods
  const allPeriodes = [...new Set(records.map((r) => r.periode))].sort();

  // 2. Aggregate per account, combining amounts + reasons from records
  const accountMap = new Map<
    string,
    { klasifikasi: Set<string>; remark: Set<string>; amounts: Map<string, number> }
  >();
  for (const r of records) {
    if (!accountMap.has(r.accountCode)) {
      accountMap.set(r.accountCode, {
        klasifikasi: new Set(),
        remark:      new Set(),
        amounts:     new Map(),
      });
    }
    const entry = accountMap.get(r.accountCode)!;
    entry.amounts.set(r.periode, (entry.amounts.get(r.periode) ?? 0) + r.amount);
    r.klasifikasi.split(';').map((s) => s.trim()).filter(Boolean).forEach((k) => entry.klasifikasi.add(k));
    r.remark.split(';').map((s) => s.trim()).filter(Boolean).forEach((k) => entry.remark.add(k));
  }

  // 3. Headers: ['G/L Account', ...periods]
  const headers         = ['G/L Account', ...allPeriodes];
  const originalHeaders = headers.slice();
  const accountColIdx   = 0;

  // 4. AmountCols — one entry per period
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const amountCols: AmountCol[] = allPeriodes.map((p, i) => {
    const [yr, mo] = p.split('.');
    const moNum    = parseInt(mo) - 1;
    const moLabel  = MONTH_LABELS[moNum] ?? mo;
    return {
      colIdx:       i + 1, // col 0 = account code
      label:        p,
      yearLabel:    yr,
      dateLabel:    `${moLabel} '${yr.slice(2)}`,
      isCumulative: false,
    };
  });

  // 5. Period indices
  const momCurrIdx = amountCols.length - 1;
  const momPrevIdx = amountCols.length >= 2 ? amountCols.length - 2 : 0;
  const yoyCurrIdx = momCurrIdx;

  // YoY prev: find same month last year; fallback to first period
  const currPeriode          = allPeriodes[allPeriodes.length - 1] ?? '';
  const [currYr, currMo]     = currPeriode.split('.');
  const yoyPrevPeriode       = `${parseInt(currYr) - 1}.${currMo}`;
  let   yoyPrevIdx           = allPeriodes.indexOf(yoyPrevPeriode);
  if (yoyPrevIdx < 0) yoyPrevIdx = 0;
  if (yoyPrevIdx === yoyCurrIdx && amountCols.length > 1) yoyPrevIdx = 0;

  // YtD: Jan–currMo of currYr vs Jan–currMo of prevYr
  const { currIdxs: ytdCurrColIdxs, prevIdxs: ytdPrevColIdxs, label: ytdLabel } =
    buildYtdColIdxs(amountCols, momCurrIdx);

  // 6. Build rows
  const rows: RekapSheetRow[] = [];
  const sortedAccounts = [...accountMap.keys()].sort();
  for (const accountCode of sortedAccounts) {
    const { klasifikasi, remark, amounts } = accountMap.get(accountCode)!;
    const values: (string | number)[] = [
      accountCode,
      ...allPeriodes.map((p) => amounts.get(p) ?? 0),
    ];

    const curr    = amounts.get(allPeriodes[momCurrIdx] ?? '')  ?? 0;
    const prev    = amounts.get(allPeriodes[momPrevIdx] ?? '')  ?? 0;
    const yoyCurr = amounts.get(allPeriodes[yoyCurrIdx] ?? '') ?? 0;
    const yoyPrev = amounts.get(allPeriodes[yoyPrevIdx] ?? '') ?? 0;

    const gapMoM = curr - prev;
    const pctMoM = prev !== 0 ? (gapMoM / Math.abs(prev)) * 100 : 0;
    const gapYoY = yoyCurr - yoyPrev;
    const pctYoY = yoyPrev !== 0 ? (gapYoY / Math.abs(yoyPrev)) * 100 : 0;

    const ytdCurr = ytdCurrColIdxs.reduce((s, i) => s + (amounts.get(allPeriodes[i] ?? '') ?? 0), 0);
    const ytdPrev = ytdPrevColIdxs.reduce((s, i) => s + (amounts.get(allPeriodes[i] ?? '') ?? 0), 0);
    const gapYtD  = ytdCurr - ytdPrev;
    const pctYtD  = ytdPrev !== 0 ? (gapYtD / Math.abs(ytdPrev)) * 100 : 0;

    rows.push({
      values,
      type:       'detail',
      gapMoM,  pctMoM,
      gapYoY,  pctYoY,
      gapYtD,  pctYtD,
      ytdCurrV: ytdCurr,
      ytdPrevV: ytdPrev,
      reasonMoM: [...klasifikasi].filter(Boolean).join('; '),
      reasonYoY: '',
      reasonYtD: '',
    });
  }

  return {
    sheetName:       'Rekap (Auto)',
    headers,
    originalHeaders,
    amountCols,
    accountColIdx,
    momCurrIdx,
    momPrevIdx,
    yoyCurrIdx,
    yoyPrevIdx,
    ytdCurrColIdxs,
    ytdPrevColIdxs,
    ytdLabel,
    rows,
  };
};

// Cached formatters — created once, reused on every render
const FMT_RP  = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const FMT_PCT = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRp  = (n: number) => FMT_RP.format(n);
const fmtPct = (n: number) => FMT_PCT.format(n) + '%';

/** Build a full deterministic analysis string from period data (pre-AI) */
const buildTemplateReason = (
  gap: number,
  pct: number,
  accountName: string,
  side: 'mom' | 'yoy',
  amountCols: AmountCol[],
  rowValues: (string | number)[],
  currIdx: number,
  prevIdx: number,
): string => {
  const name = accountName || 'Akun ini';
  const absPct = Math.abs(pct);

  if (gap === 0)
    return `Tidak ada fluktuasi ${side === 'mom' ? 'MoM' : 'YoY'} — nilai ${name} tidak berubah pada periode ini.`;

  const dir     = gap > 0 ? 'Kenaikan' : 'Penurunan';
  const dirLow  = gap > 0 ? 'kenaikan' : 'penurunan';
  const abs     = Math.abs(gap);
  const fmtAmt  = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1_000_000_000) return `${FMT_RP.format(Math.round(a / 1_000_000_000 * 10) / 10)} M`;
    if (a >= 1_000_000)     return `${FMT_RP.format(Math.round(a / 1_000_000))} JT`;
    if (a >= 1_000)         return `${FMT_RP.format(Math.round(a / 1_000))} RB`;
    return FMT_RP.format(a);
  };
  const fmtFull = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1_000_000_000) return `${FMT_RP.format(Math.round(a / 1_000_000_000 * 10) / 10)} M`;
    if (a >= 1_000_000)     return `${FMT_RP.format(Math.round(a / 1_000_000))} JT`;
    return FMT_RP.format(a);
  };

  // Collect point (non-cumulative) periods in order
  const pointCols = amountCols
    .map((ac, i) => ({ ac, i, val: parseNum(rowValues[ac.colIdx]) }))
    .filter(x => !x.ac.isCumulative);

  const currAC = amountCols[currIdx];
  const prevAC = amountCols[prevIdx];
  const currVal = currAC ? parseNum(rowValues[currAC.colIdx]) : 0;
  const prevVal = prevAC ? parseNum(rowValues[prevAC.colIdx]) : 0;
  const currLabel = currAC ? (currAC.dateLabel || currAC.label) : 'Periode ini';
  const prevLabel = prevAC ? (prevAC.dateLabel || prevAC.label) : 'Periode sebelumnya';

  // Magnitude classification
  const magn = absPct >= 50 ? 'sangat tajam'
    : absPct >= 20 ? 'signifikan'
    : absPct >= 5  ? 'moderat'
    : 'minor';

  // Trend across ALL point periods
  let trendLine = '';
  if (pointCols.length >= 3) {
    const vals = pointCols.map(x => x.val);
    const nonZero = vals.filter(v => v !== 0);
    const maxVal = Math.max(...nonZero);
    const minVal = Math.min(...nonZero);
    const firstNZ = nonZero[0] ?? 0;
    const lastNZ  = nonZero[nonZero.length - 1] ?? 0;

    // Count consecutive direction changes
    let rises = 0, falls = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > vals[i - 1]) rises++;
      else if (vals[i] < vals[i - 1]) falls++;
    }
    const total = rises + falls;
    const trendDesc = total === 0 ? 'stabil'
      : rises === total ? 'naik konsisten'
      : falls === total ? 'turun konsisten'
      : rises > falls   ? 'cenderung naik'
      : 'cenderung turun';

    // Highest and lowest period labels
    const maxIdx = pointCols.findIndex(x => x.val === maxVal);
    const minIdx = pointCols.findIndex(x => x.val === minVal);
    const maxLabel = pointCols[maxIdx]?.ac.dateLabel || '';
    const minLabel = pointCols[minIdx]?.ac.dateLabel || '';

    const periodSummary = pointCols
      .filter(x => x.val !== 0)
      .slice(-5) // last 5 to keep it readable
      .map(x => `${x.ac.dateLabel || x.ac.label}: ${fmtFull(x.val)}`)
      .join(', ');

    trendLine = `Tren nilai ${name} ${trendDesc} sepanjang periode yang tersedia (${periodSummary}). ` +
      `Nilai tertinggi tercatat pada ${maxLabel} sebesar ${fmtFull(maxVal)}, nilai terendah pada ${minLabel} sebesar ${fmtFull(minVal)}.`;
  }

  // Direct period comparison bullet
  const compLine = `Nilai ${currLabel} sebesar ${fmtFull(currVal)} ` +
    `dibandingkan ${prevLabel} sebesar ${fmtFull(prevVal)}, ` +
    `mencerminkan ${dirLow} sebesar ${fmtAmt(abs)} (${FMT_PCT.format(absPct)}%).`;

  // Change rate context
  const rateLine = `Perubahan sebesar ${FMT_PCT.format(absPct)}% tergolong ${magn} ` +
    `untuk ${side === 'mom' ? 'perbandingan bulanan (MoM)' : 'perbandingan tahunan (YoY)'}.`;

  const lines = [
    `${dir} ${name} sebesar ${fmtAmt(abs)} (${FMT_PCT.format(absPct)}%) ` +
      `pada ${currLabel} dibandingkan ${prevLabel}${side === 'mom' ? ' (MoM)' : ' (YoY)'}.`,
    `   - ${compLine}`,
    trendLine ? `   - ${trendLine}` : null,
    `   - ${rateLine}`,
  ].filter(Boolean);

  return lines.join('\n');
};

const classifyRow = (values: any[], accountColIdx: number): RekapSheetRow['type'] => {
  if (values.every((v) => v === '' || v === null || v === undefined)) return 'empty';
  const acct = String(values[accountColIdx] ?? '').trim();

  // If row has a proper numeric account code (5+ digits), classify by account pattern only
  // This prevents keyword false-positives from SAP-generated totals in other columns
  if (/^\d{5,}$/.test(acct)) {
    // Account ends in 4+ zeros → subtotal (e.g. 71510000, 71500000)
    if (/0{4,}$/.test(acct)) return 'subtotal';
    // Otherwise it's a detail account regardless of other columns
    return 'detail';
  }

  // No valid account code — check for explicit subtotal keywords in text cells
  const hasSubtotalKeyword = values.some((v, i) => {
    if (i === accountColIdx) return false;
    // Only match against text cells, not numeric values
    const s = String(v ?? '');
    if (/^[\d\s.,\-]+$/.test(s)) return false;
    return /\b(total|jumlah|sub[\s\-]?total|gesamt)\b/i.test(s);
  });
  if (hasSubtotalKeyword) return 'subtotal';

  // No account and no keywords — if has numeric values it's a category subtotal row
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
 * Convert Excel date serial number to a readable date string like "31-Jan-25"
 */
const excelSerialToDateStr = (serial: number): string => {
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  if (isNaN(date.getTime())) return String(serial);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = months[date.getUTCMonth()];
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
};

/** Convert a cell value that might be an Excel date serial to a display string */
const normalizeHeaderCell = (val: any): string => {
  const s = String(val ?? '').trim();
  if (s === '') return '';
  // Excel serial number
  if (typeof val === 'number' && val > 40000 && val < 70000) return excelSerialToDateStr(val);
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s);
    if (n > 40000 && n < 70000) return excelSerialToDateStr(n);
  }
  // Normalize string dates: DD/MM/YYYY or DD-MM-YYYY → DD-Mon-YY
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mo = parseInt(m[2]) - 1;
    const yy = m[3].slice(-2);
    if (mo >= 0 && mo < 12) return `${dd}-${MONTHS[mo]}-${yy}`;
  }
  // Also handle YYYY/MM/DD or YYYY-MM-DD
  const m2 = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m2) {
    const dd = m2[3].padStart(2, '0');
    const mo = parseInt(m2[2]) - 1;
    const yy = m2[1].slice(-2);
    if (mo >= 0 && mo < 12) return `${dd}-${MONTHS[mo]}-${yy}`;
  }
  return s;
};

/** Returns true if a header label looks like a date/period (amount column header) */
const looksLikeDateHeader = (label: string, topLabel: string): boolean => {
  const combined = `${topLabel} ${label}`.toLowerCase();
  if (/20\d{2}/.test(combined)) return true;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mei|agt|okt)\b/i.test(combined)) return true;
  if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(combined)) return true;
  if (/total|up to|s\.d\.|ytd|kumulatif/i.test(combined)) return true;
  return false;
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
  const cumulPattern = /total|up to|s\.d\.|ytd|kumulatif/i;
  const isCumulative = cumulPattern.test(label) || cumulPattern.test(yearHint);
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
  return '#1F3864';
};

const KA_PAGE_SIZE   = 100;
const REKAP_PAGE_SIZE = 200;
const ADDED_KA_HEADERS = ['Periode', 'Klasifikasi', 'Remark'];

type Keyword = {
  id: number;
  keyword: string;
  type: string;
  result: string;
  priority: number;
  accountCodes: string;  // comma-separated; empty = berlaku untuk semua
  sourceColumn: string;  // column header name to match against; empty = default description col
};

// ─── AI Chatbot ─────────────────────────────────────────────────────────────
type ChatMsg  = { role: 'user' | 'assistant'; content: string };
type ChatPanel = {
  open: boolean;
  globalRi: number;
  accountCode: string;
  accountName: string;
  model: string;
  keyIdx: number;
  messages: ChatMsg[];
  input: string;
  loading: boolean;
  systemCtx: string;
};

// keyIdx 0 = OPENROUTER_API_KEY (Free Models Router)
// keyIdx 1–11 = OPENROUTER_API_KEY_1 … _11 (each locked to one model)
const OPENROUTER_MODELS = [
  { id: 'google/gemini-2.0-flash-001',                       label: 'Gemini 2.0 Flash',           keyIdx: 0  },
  { id: 'arcee-ai/trinity-large-preview:free',               label: 'Arcee Trinity Large',        keyIdx: 1  },
  { id: 'stepfun/step-3.5-flash:free',                       label: 'StepFun Step 3.5 Flash',     keyIdx: 2  },
  { id: 'openai/gpt-oss-120b:free',                          label: 'OpenAI GPT-OSS 120B',        keyIdx: 1  },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',               label: 'NVIDIA Nemotron 3 Nano',     keyIdx: 4  },
  { id: 'arcee-ai/trinity-mini:free',                        label: 'Arcee Trinity Mini',         keyIdx: 5  },
  { id: 'nvidia/nemotron-nano-9b-v2:free',                    label: 'NVIDIA Nemotron Nano 9B',    keyIdx: 6  },
  { id: 'upstage/solar-pro-3:free',                          label: 'Upstage Solar Pro 3',        keyIdx: 7  },
  { id: 'openai/gpt-4o-mini',                                label: 'GPT-4o Mini',                keyIdx: 8  },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free',               label: 'NVIDIA Nemotron Nano 12B',   keyIdx: 9  },
  { id: 'z-ai/glm-4.5-air',                                  label: 'Z.ai GLM 4.5 Air',           keyIdx: 10 },
  { id: 'mistralai/mistral-small-3.1-24b-instruct',          label: 'Mistral Small 3.1 24B',      keyIdx: 11 },
];

// ─── Sheet cache: L1 in-memory + L2 IndexedDB ──────────────────────────────
// L1: module-level variable — survives in-tab navigation / component remount
// L2: IndexedDB — survives full page refresh, no size limit
type SheetCacheEntry = { sheets: SheetData[]; rekap: RekapSheetData | null; fileName: string };
let _sheetCache: SheetCacheEntry | null = null;

const IDB_NAME  = 'fluktuasi-oi-v1';
const IDB_STORE = 'sheets';
const IDB_KEY   = 'current';

function _idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function idbSaveSheets(entry: SheetCacheEntry) {
  try { const db = await _idbOpen(); await new Promise<void>((res, rej) => { const tx = db.transaction(IDB_STORE,'readwrite'); const r = tx.objectStore(IDB_STORE).put(entry, IDB_KEY); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); db.close(); } catch(e) { console.warn('idbSave failed',e); }
}
async function idbLoadSheets(): Promise<SheetCacheEntry | null> {
  try { const db = await _idbOpen(); const v = await new Promise<any>((res, rej) => { const tx = db.transaction(IDB_STORE,'readonly'); const r = tx.objectStore(IDB_STORE).get(IDB_KEY); r.onsuccess=()=>res(r.result??null); r.onerror=()=>rej(r.error); }); db.close(); return v; } catch(e) { console.warn('idbLoad failed',e); return null; }
}
async function idbClearSheets() {
  try { const db = await _idbOpen(); await new Promise<void>((res, rej) => { const tx = db.transaction(IDB_STORE,'readwrite'); const r = tx.objectStore(IDB_STORE).delete(IDB_KEY); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); db.close(); } catch(e) { console.warn('idbClear failed',e); }
}

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
  // ── AI Reason State ────────────────────────────────────────────────────────
  const [aiReasons,  setAiReasons]  = useState<Record<number, { mom?: string; yoy?: string; ytd?: string }>>({}); 
  const [aiLoading,  setAiLoading]  = useState<Record<string, boolean>>({});
  const [aiErrors,   setAiErrors]   = useState<Record<string, string>>({});
  const [aiBatch,    setAiBatch]    = useState<{ done: number; total: number } | null>(null);
  const aiCancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableResultRef = useRef<HTMLDivElement>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [chat, setChat] = useState<ChatPanel | null>(null);

  // Period selection for MoM / YoY / YtD — null = use auto-detected default
  const [momSel, setMomSel] = useState<{ curr: number; prev: number } | null>(null);
  const [yoySel, setYoySel] = useState<{ curr: number; prev: number } | null>(null);
  // YtD: single amountCols index per year; if isCumulative → use directly, else sum Jan→mo
  const [ytdSel, setYtdSel] = useState<{ curr: number; prev: number } | null>(null);
  // Column visibility — null = all visible; Set = only those amountCol indices
  const [visibleAmtColIdxs, setVisibleAmtColIdxs] = useState<Set<number> | null>(null);
  const [showColPicker,     setShowColPicker]     = useState(false);
  // Reset period selection when a new file is loaded
  useEffect(() => { setMomSel(null); setYoySel(null); setYtdSel(null); setVisibleAmtColIdxs(null); setShowColPicker(false); }, [rekapSheetData]);
  
  // ── Keyword Management States ──────────────────────────────────────────────
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [showKeywordModal, setShowKeywordModal] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState<Keyword | null>(null);
  const [keywordForm, setKeywordForm] = useState({
    keyword: '',
    type: 'klasifikasi',
    result: '',
    priority: 0,
    accountCodes: '',
    sourceColumn: '',
  });
  const [keywordFilter, setKeywordFilter] = useState<'all' | 'klasifikasi' | 'remark'>('all');
  const [showKeywordSection, setShowKeywordSection] = useState(false);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [inputMode, setInputMode] = useState<'simple' | 'advanced'>('simple');
  const [naturalInput, setNaturalInput] = useState('');
  const [keywordSearch, setKeywordSearch] = useState('');
  const [keywordAkunSearch, setKeywordAkunSearch] = useState('');
  const [keywordPage, setKeywordPage] = useState(0);
  const KEYWORD_PAGE_SIZE = 10;
  const [kwMode, setKwMode] = useState<'normal' | 'regex' | 'not' | 'docno' | 'col'>('normal');
  const [colHeader, setColHeader] = useState('');
  const [colPattern, setColPattern] = useState('');
  const [isReapplying, setIsReapplying] = useState(false);

  // ── DB Akun Periode States ─────────────────────────────────────────────────
  const [dbAkunPeriodes,  setDbAkunPeriodes]  = useState<AkunPeriodeRecord[]>([]);
  const [loadingDbRekap,  setLoadingDbRekap]  = useState(false);
  const [dbPeriodeStats,  setDbPeriodeStats]  = useState<{ periodes: string[]; accounts: number } | null>(null);
  const [selectedPeriodes, setSelectedPeriodes] = useState<Set<string>>(new Set());

  // ── Animation refs ────────────────────────────────────────────────────────
  const pageContentRef   = useRef<HTMLDivElement>(null);
  const keywordBodyRef   = useRef<HTMLTableSectionElement>(null);
  const rekapBodyRef     = useRef<HTMLTableSectionElement>(null);
  const modalRef         = useRef<HTMLDivElement>(null);
  const modalBackdropRef = useRef<HTMLDivElement>(null);
  const modalFormBodyRef = useRef<HTMLDivElement>(null);
  const dbStatsRef       = useRef<HTMLDivElement>(null);
  const chatBackdropRef  = useRef<HTMLDivElement>(null);
  const chatModalRef     = useRef<HTMLDivElement>(null);
  const kaTableRef       = useRef<HTMLDivElement>(null);

  // ── Per-account row hydration (lazy DB fetch) ──────────────────────────────
  const fetchingAccountsRef = useRef<Set<string>>(new Set());
  const hydrateSheetRows = useCallback(async (idx: number, accountCode: string) => {
    if (fetchingAccountsRef.current.has(accountCode)) return;
    fetchingAccountsRef.current.add(accountCode);
    try {
      const res = await fetch(`/api/fluktuasi/sheet-rows?accountCode=${encodeURIComponent(accountCode)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.data) return;
      const rec = data.data;
      if (!Array.isArray(rec.rows) || rec.rows.length === 0) return;
      setSheetDataList(prev => prev.map((sd, i) => i !== idx ? sd : {
        ...sd,
        rows:              rec.rows as Record<string, any>[],
        headers:           (rec.headers           as string[]) ?? sd.headers,
        originalHeaders:   (rec.originalHeaders   as string[]) ?? sd.originalHeaders,
        klasifikasiColIdx: rec.klasifikasiColIdx  ?? sd.klasifikasiColIdx,
        docnoColIdx:       rec.docnoColIdx        ?? sd.docnoColIdx,
      }));
    } catch(e) {
      console.warn('hydrateSheetRows failed', e);
    } finally {
      fetchingAccountsRef.current.delete(accountCode);
    }
  }, []);

  // ── Load data from database on mount ──────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      // L1: in-memory (same session, instant)
      if (_sheetCache && _sheetCache.sheets.some(s => s.rows.length > 0)) {
        setSheetDataList(_sheetCache.sheets);
        setRekapSheetData(_sheetCache.rekap);
        setFileName(_sheetCache.fileName);
        return;
      }
      // L2: IndexedDB (survives page refresh, no size limit)
      const idbEntry = await idbLoadSheets();
      if (idbEntry && idbEntry.sheets.some(s => s.rows.length > 0)) {
        _sheetCache = idbEntry;
        setSheetDataList(idbEntry.sheets);
        setRekapSheetData(idbEntry.rekap);
        setFileName(idbEntry.fileName);
        return;
      }

      try {
        const res = await fetch('/api/fluktuasi?uploadedBy=system');
        if (res.ok) {
          const result = await res.json();
          if (result.success && result.data) {
            setFileName(result.data.fileName);
            const rawSheets: SheetData[] = Array.isArray(result.data.sheetDataList)
              ? result.data.sheetDataList
              : [];
            const rekap: RekapSheetData | null = result.data.rekapSheetData ?? null;
            setRekapSheetData(rekap);
            setSheetDataList(rawSheets);
            // If all sheets are stripped and we have the new sheet-rows DB,
            // eagerly load the first account so the tab bar appears.
            if (rawSheets.length > 0 && rawSheets.every(s => s.rows.length === 0)) {
              hydrateSheetRows(0, rawSheets[0].sheetName);
            }
          }
        }
      } catch (error) {
        console.log('Tidak ada data fluktuasi sebelumnya');
      }
    };
    loadData();
    loadKeywords();
    loadDbStats();
  }, []);

  // Realtime: debounce refresh so rapid batch imports don’t hammer the API
  const _fluktuasiDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeUpdates(['fluktuasi'], useCallback(() => {
    if (_fluktuasiDebounce.current) clearTimeout(_fluktuasiDebounce.current);
    _fluktuasiDebounce.current = setTimeout(() => {
      loadKeywords();
      loadDbStats();
    }, 400);
  }, [loadKeywords, loadDbStats]));

  // ── Load keywords ──────────────────────────────────────────────────────────
  const loadKeywords = useCallback(async () => {
    try {
      const res = await fetch('/api/fluktuasi/keywords');
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          setKeywords(result.data);
        }
      }
    } catch (error) {
      console.error('Error loading keywords:', error);
    }
  }, []);

  // ── Load example keywords ──────────────────────────────────────────────────
  const handleLoadExamples = async () => {
    if (!confirm('Load contoh keywords? (Data existing tidak akan terhapus)')) return;
    try {
      const res = await fetch('/api/fluktuasi/keywords/seed', {
        method: 'POST',
      });
      const result = await res.json();
      if (result.success) {
        toast.info(result.message);
        loadKeywords();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('Error loading examples:', error);
      toast.error('Gagal load contoh keywords');
    }
  };

  // ── Check Duplicate Keyword ────────────────────────────────────────────────
  const checkDuplicateKeyword = useCallback((keyword: string, type: string, accountCodes: string, excludeId?: number): boolean => {
    const keywordLower = keyword.toLowerCase().trim();
    const acctNorm = (accountCodes ?? '').trim().toLowerCase();
    return keywords.some(kw => 
      kw.keyword.toLowerCase().trim() === keywordLower && 
      kw.type === type && 
      (kw.accountCodes ?? '').trim().toLowerCase() === acctNorm &&
      (!excludeId || kw.id !== excludeId)
    );
  }, [keywords]);

  // ── Save/Update Keyword ────────────────────────────────────────────────────
  const handleSaveKeyword = async (formOverride?: any) => {
    try {
      const formToUse = formOverride || keywordForm;
      
      // Frontend validation for duplicate
      const isDuplicate = checkDuplicateKeyword(
        formToUse.keyword, 
        formToUse.type,
        formToUse.accountCodes ?? '',
        editingKeyword?.id
      );
      
      if (isDuplicate) {
        toast.info(`Keyword "${formToUse.keyword}" dengan type "${formToUse.type}" sudah ada. Silakan gunakan keyword yang berbeda.`);
        return;
      }
      
      const method = editingKeyword ? 'PUT' : 'POST';
      const body = editingKeyword
        ? { ...formToUse, id: editingKeyword.id }
        : formToUse;

      const res = await fetch('/api/fluktuasi/keywords', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (result.success) {
        toast.info(result.message);
        loadKeywords();
        setShowKeywordModal(false);
        setEditingKeyword(null);
        setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0, accountCodes: '', sourceColumn: '' });
        setNaturalInput('');
        setInputMode('simple');
        setKwMode('normal');
        setColHeader('');
        setColPattern('');
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('Error saving keyword:', error);
      toast.error('Gagal menyimpan keyword');
    }
  };

  // ── Delete Keyword ─────────────────────────────────────────────────────────
  const handleDeleteKeyword = async (id: number) => {
    if (!confirm('Yakin hapus keyword ini?')) return;
    try {
      const res = await fetch(`/api/fluktuasi/keywords?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) { loadKeywords(); }
      else { toast.error(result.error); }
    } catch (error) {
      console.error('Error deleting keyword:', error);
      toast.error('Gagal menghapus keyword');
    }
  };

  const handleDeleteAllKeywords = async () => {
    if (!confirm(`Yakin hapus SEMUA ${keywords.length} keyword? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const res = await fetch('/api/fluktuasi/keywords?all=true', { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        toast.info(result.message);
        loadKeywords();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('Error deleting all keywords:', error);
      toast.error('Gagal menghapus semua keyword');
    }
  };

  const handleReapplyKeywords = async () => {
    if (!confirm(`Re-terapkan ${keywords.length} keyword ke seluruh data yang tersimpan? Proses ini akan memperbarui klasifikasi semua record di database.`)) return;
    setIsReapplying(true);
    try {
      const res    = await fetch('/api/fluktuasi/re-apply-keywords', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        toast.success(result.message);
        loadDbStats();
      } else {
        toast.error(result.error ?? 'Gagal re-terapkan keyword');
      }
    } catch (error) {
      console.error('Error re-applying keywords:', error);
      toast.error('Gagal re-terapkan keyword');
    } finally {
      setIsReapplying(false);
    }
  };

  // ── DB Akun Periode helpers ────────────────────────────────────────────────
  const PERIODE_MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const formatPeriodeLabel = (p: string) => {
    const [yr, mo] = p.split('.');
    return `${PERIODE_MONTHS[parseInt(mo) - 1] ?? mo} ${yr}`;
  };

  // Sync selection saat periode tersimpan berubah (default: semua terpilih)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dbPeriodeStats) {
      setSelectedPeriodes(new Set(dbPeriodeStats.periodes));
    } else {
      setSelectedPeriodes(new Set());
    }
  }, [dbPeriodeStats]);

  const togglePeriode = (p: string) => {
    setSelectedPeriodes(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const deleteSelectedPeriodes = async () => {
    const toDelete = [...selectedPeriodes];
    if (toDelete.length === 0) return;
    const label = toDelete.length === 1
      ? `periode ${formatPeriodeLabel(toDelete[0])}`
      : `${toDelete.length} periode terpilih`;
    if (!confirm(`Hapus ${label} dari database? Tindakan ini tidak dapat dibatalkan.`)) return;
    setLoadingDbRekap(true);
    try {
      await Promise.all(
        toDelete.map(p => fetch(`/api/fluktuasi/akun-periodes?periode=${encodeURIComponent(p)}`, { method: 'DELETE' }))
      );
      setRekapSheetData(null);
      toast.success(`${label} berhasil dihapus.`);
      await loadDbStats();
    } catch {
      toast.error('Gagal menghapus periode terpilih');
    } finally {
      setLoadingDbRekap(false);
    }
  };

  const loadDbStats = useCallback(async () => {
    try {
      const res = await fetch('/api/fluktuasi/akun-periodes');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const records: AkunPeriodeRecord[] = data.data;
        setDbAkunPeriodes(records);
        const periodes  = [...new Set(records.map((r) => r.periode))].sort();
        const accounts  = new Set(records.map((r) => r.accountCode)).size;
        setDbPeriodeStats({ periodes, accounts });
      }
    } catch (e) {
      console.error('Gagal load DB stats:', e);
    }
  }, []);

  const loadAndBuildRekapFromDB = async () => {
    setLoadingDbRekap(true);
    try {
      const res = await fetch('/api/fluktuasi/akun-periodes');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
        toast.info('Belum ada data tersimpan di database. Upload file terlebih dahulu.');
        return;
      }
      const records: AkunPeriodeRecord[] = data.data;
      setDbAkunPeriodes(records);
      const periodes = [...new Set(records.map((r) => r.periode))].sort();
      setDbPeriodeStats({ periodes, accounts: new Set(records.map((r) => r.accountCode)).size });
      // Hanya bangun & tampilkan rekap dari DB jika belum ada data dari file upload
      if (sheetDataList.length === 0) {
        // Filter berdasarkan periode yang terpilih (selectedPeriodes kosong = ambil semua)
        const aktivePeriodes = selectedPeriodes.size > 0 ? selectedPeriodes : new Set(periodes);
        const filtered = records.filter(r => aktivePeriodes.has(r.periode));
        const rekap = buildRekapFromAkunPeriodes(filtered.length > 0 ? filtered : records);
        setRekapSheetData(rekap);
        setAiReasons({});
      }
    } catch (e: any) {
      toast.error('Gagal memuat data dari DB: ' + (e?.message || e));
    } finally {
      setLoadingDbRekap(false);
    }
  };

  const clearDbData = async () => {
    if (!confirm('Hapus semua data akun-periode yang tersimpan di DB? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      const [res1, res2] = await Promise.all([
        fetch('/api/fluktuasi/akun-periodes', { method: 'DELETE' }),
        fetch('/api/fluktuasi?uploadedBy=system&keepLast=0', { method: 'DELETE' }),
      ]);
      const data = await res1.json();
      if (data.success) {
        setDbAkunPeriodes([]);
        setDbPeriodeStats(null);
        setSheetDataList([]);
        setRekapSheetData(null);
        setFileName('');
        _sheetCache = null;
        idbClearSheets();
        fetch('/api/fluktuasi/sheet-rows', { method: 'DELETE' }).catch(() => {});
        toast.info(data.message);
      }
    } catch (e) {
      toast.error('Gagal menghapus data DB');
    }
  };

  // ── Open Edit Modal ────────────────────────────────────────────────────────
  const handleEditKeyword = (kw: Keyword) => {
    setEditingKeyword(kw);
    setKeywordForm({ keyword: kw.keyword, type: kw.type, result: kw.result, priority: kw.priority, accountCodes: kw.accountCodes ?? '', sourceColumn: kw.sourceColumn ?? '' });
    // Detect and sync kwMode
    const lk = kw.keyword.toLowerCase();
    if (lk.startsWith('col:')) {
      const without = kw.keyword.slice(4);
      const ci = without.indexOf(':');
      setColHeader(ci >= 0 ? without.slice(0, ci) : without);
      setColPattern(ci >= 0 ? without.slice(ci + 1) : '');
      setKwMode('col');
    } else if (lk.startsWith('regex:')) {
      setKwMode('regex');
    } else if (lk.startsWith('not:')) {
      setKwMode('not');
    } else if (lk.startsWith('docno:')) {
      setKwMode('docno');
    } else {
      setKwMode('normal');
    }
    setShowKeywordModal(true);
  };

  // ── Save to database ──────────────────────────────────────────────────
  const saveToDatabase = async (fname: string, sheets: SheetData[], rekap: RekapSheetData | null) => {
    try {
      // Strip row data before saving — full rows can exceed Vercel's 4.5 MB body limit.
      // Detail rows are only available in the current upload session.
      const sheetsMetaOnly = sheets.map(({ rows: _rows, ...meta }) => ({ ...meta, rows: [] }));
      const res = await fetch('/api/fluktuasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: fname,
          sheetDataList: sheetsMetaOnly,
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
    setUploadError('');
    setFileName(file.name);
    setSheetDataList([]);
    setRekapSheetData(null);
    setActiveSheetIdx(0);

    // Reset input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const XLSXLib = await loadXLSX();
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSXLib.read(arrayBuffer, { cellDates: false });
      const sheetNames: string[] = workbook.SheetNames || [];

      const kodeAkunSheets = sheetNames.filter((n) => /^\d+$/.test(n.trim()));
      const rekapSheetName = sheetNames.find((n) => !/^\d+$/.test(n.trim())) ?? null;

      if (kodeAkunSheets.length === 0) {
        setUploadError(
          `Tidak ada sheet kode akun (nama numerik) yang ditemukan. ` +
          `Sheet yang ada: ${sheetNames.map(n => `"${n}"`).join(', ')}. ` +
          `Pastikan nama sheet berupa angka kode akun (contoh: 62301, 62302).`
        );
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

        // Prefer genuine text columns; Assignment/Zuordnung are numeric codes — put last
        let remarkColIdxRaw = findColIdx(headers, [
          'Text','Item Text','PO Text','Teks','Keterangan Item','Narasi Item',
          'Reference','Ref. Doc.','Ref. document',
          'Assignment','Zuordnung',
        ]);
        // Guard: if selected column is mostly numeric, auto-detect best remaining text col
        {
          const sampleRowsR = raw.slice(headerRowIdx + 1, headerRowIdx + 30);
          const isColNumeric = (ci: number) => {
            if (ci < 0) return true;
            const vals = sampleRowsR.map((r) => String(r?.[ci] ?? '').trim()).filter((v) => v.length > 0);
            if (!vals.length) return true;
            const numericCount = vals.filter((v) => !isNaN(Number(v.replace(/[.,]/g, ''))) && v.length > 2).length;
            return numericCount > vals.length * 0.6;
          };
          if (isColNumeric(remarkColIdxRaw)) {
            // Find best text column: longest avg, not numeric, not date, not klasifikasi
            let bestAvgR = 0;
            headers.forEach((_, col) => {
              if (col === dateColIdx || col === klasifikasiColIdx) return;
              const vals = sampleRowsR.map((r) => String(r?.[col] ?? '').trim()).filter((v) => v.length > 0);
              if (!vals.length) return;
              const numericCount = vals.filter((v) => !isNaN(Number(v.replace(/[.,]/g, '')))).length;
              if (numericCount > vals.length * 0.5) return;
              const avg = vals.reduce((acc, v) => acc + v.length, 0) / vals.length;
              if (avg > bestAvgR) { bestAvgR = avg; remarkColIdxRaw = col; }
            });
          }
        }
        const remarkColIdx = remarkColIdxRaw >= 0 && remarkColIdxRaw !== klasifikasiColIdx
          ? remarkColIdxRaw
          : klasifikasiColIdx;

        // Detect document number column (column B / SAP Belegnummer)
        const docnoColIdx = findColIdx(headers, [
          'Document No.', 'Doc. No.', 'Doc.No.', 'DocNo', 'Document Number',
          'Belegnummer', 'Belnr', 'Doc Number', 'No. Dokumen', 'Nomor Dokumen',
          'No Dokumen', 'Nomer Dokumen',
        ]);

        // Detect amount column for period aggregation
        const amountColIdx = findAmountColIdx(
          headers, raw, headerRowIdx,
          [dateColIdx, klasifikasiColIdx, docnoColIdx].filter((i) => i >= 0),
        );

        const rows: Record<string, any>[] = [];
        for (let r = headerRowIdx + 1; r < raw.length; r++) {
          const rawRow = raw[r];
          if (!rawRow || rawRow.every((c: any) => c === '' || c === null)) continue;
          const obj: Record<string, any> = {};
          headers.forEach((h, idx) => { obj[h] = rawRow[idx] ?? ''; });
          obj['__periode']     = parseDateToPeriode(dateColIdx >= 0 ? rawRow[dateColIdx] : '');
          
          // Both klasifikasi and remark are matched from the same source text (description column)
          // against different keyword types. Keywords in master define the output; no raw-text fallback.
          const sourceText = String(klasifikasiColIdx >= 0 ? rawRow[klasifikasiColIdx] : '');
          const docnoText  = String(docnoColIdx >= 0 ? rawRow[docnoColIdx] : '');

          obj['__klasifikasi'] = matchKeywords(sourceText, keywords, 'klasifikasi', docnoText, obj);
          obj['__remark']      = matchKeywords(sourceText, keywords, 'remark',       docnoText, obj);
          // Store raw source text so keywords can be re-matched reactively after the file is parsed
          obj['__klasifikasi_raw'] = sourceText;
          obj['__remark_raw']      = sourceText;   // same source — keyword type drives the output
          obj['__docno_raw']       = docnoText;
          obj['__amount']          = amountColIdx >= 0 ? parseNum(rawRow[amountColIdx]) : 0;
          rows.push(obj);
        }
        result.push({ sheetName, headers, originalHeaders, rows, klasifikasiColIdx, docnoColIdx });
      }
      setSheetDataList(result);

      if (result.length === 0) {
        setUploadError(
          `Sheet kode akun ditemukan (${kodeAkunSheets.join(', ')}) tetapi semua sheet kosong atau hanya memiliki 1 baris. ` +
          `Pastikan setiap sheet memiliki baris header dan minimal 1 baris data.`
        );
      } else {
        // Auto-scroll ke tabel hasil setelah upload berhasil
        setTimeout(() => tableResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      }

      // ── Aggregate amounts per account per period + save to DB ─────────────
      const akunPeriodesFlat: AkunPeriodeRecord[] = [];
      for (const sd of result) {
        const periodeAmtMap    = new Map<string, number>();
        const periodeKlasiMap  = new Map<string, Set<string>>();
        const periodeRemarkMap = new Map<string, Set<string>>();
        for (const row of sd.rows) {
          const p  = String(row['__periode'] ?? '').trim();
          const a  = parseNum(row['__amount'] ?? 0);
          if (!p) continue;
          periodeAmtMap.set(p, (periodeAmtMap.get(p) ?? 0) + a);
          if (!periodeKlasiMap.has(p))  periodeKlasiMap.set(p, new Set());
          if (!periodeRemarkMap.has(p)) periodeRemarkMap.set(p, new Set());
          const k  = String(row['__klasifikasi'] ?? '').trim();
          const rv = String(row['__remark']      ?? '').trim();
          if (k)  periodeKlasiMap.get(p)!.add(k);
          if (rv) periodeRemarkMap.get(p)!.add(rv);
        }
        for (const [periode, amount] of periodeAmtMap.entries()) {
          akunPeriodesFlat.push({
            accountCode: sd.sheetName,
            periode,
            amount,
            klasifikasi: [...(periodeKlasiMap.get(periode)  ?? [])].join('; '),
            remark:      [...(periodeRemarkMap.get(periode) ?? [])].join('; '),
          });
        }
      }
      // Fire-and-forget: save aggregated data to DB
      if (akunPeriodesFlat.length > 0) {
        fetch('/api/fluktuasi/akun-periodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: akunPeriodesFlat, uploadedBy: 'system', fileName: file.name }),
        })
          .then((r) => r.json())
          .then(() => loadDbStats())
          .then(async () => {
            // ── If no rekap sheet was found in the uploaded file, rebuild the full
            // rekap table from ALL periods stored in DB (current + previous uploads).
            // The initial rekap shown above only covered the current file; this
            // replaces it with the complete multi-period view once the DB save is done.
            if (!rekapSheetName) {
              try {
                const resp  = await fetch('/api/fluktuasi/akun-periodes');
                const dbData = await resp.json();
                if (dbData.success && Array.isArray(dbData.data) && dbData.data.length > 0) {
                  const allRecords: AkunPeriodeRecord[] = dbData.data;
                  const fullRekap = buildRekapFromAkunPeriodes(allRecords);
                  setRekapSheetData(fullRekap);
                  setDbAkunPeriodes(allRecords);
                  // Update IDB cache so next session loads the full rekap
                  idbSaveSheets({ sheets: result, rekap: fullRekap, fileName: file.name });
                }
              } catch (e) {
                console.warn('Could not rebuild full multi-period rekap from DB:', e);
              }
            }
          })
          .catch((e) => console.error('Gagal menyimpan akun periodes:', e));
      }

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
            const t = normalizeHeaderCell(topRow[c]);
            const b = normalizeHeaderCell(bottomRow[c]);
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
            // Header must look like a date/period to be an amount column
            // This prevents description columns from being misclassified
            if (!looksLikeDateHeader(fullHeaders[col], topLabels[col])) continue;
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

          // MoM curr: last non-cumulative col, or last of any col
          const momCurrAC = pointCols.length >= 1
            ? pointCols[pointCols.length - 1]
            : amountCols[amountCols.length - 1];
          const momCurrIdx = amountCols.findIndex(c => c.colIdx === momCurrAC?.colIdx);

          // MoM prev: second-to-last non-cumul col if available;
          // otherwise the column IMMEDIATELY BEFORE momCurrIdx in amountCols
          // (do NOT use amountCols.length-2 which can equal momCurrIdx itself)
          let momPrevIdx: number;
          if (pointCols.length >= 2) {
            momPrevIdx = amountCols.findIndex(c => c.colIdx === pointCols[pointCols.length - 2].colIdx);
          } else if (momCurrIdx > 0) {
            momPrevIdx = momCurrIdx - 1;
          } else if (amountCols.length > 1) {
            momPrevIdx = 1; // curr is at 0, pick next
          } else {
            momPrevIdx = 0; // only one column — nothing to compare
          }

          // YoY: same curr; earliest available non-cumul col as prev (or first of all)
          const yoyCurrIdx = momCurrIdx;
          let yoyPrevIdx = pointCols.length >= 2
            ? amountCols.findIndex(c => c.colIdx === pointCols[0].colIdx)
            : amountCols.length >= 2 ? 0 : 0;
          if (yoyPrevIdx === yoyCurrIdx && amountCols.length > 1) {
            yoyPrevIdx = yoyCurrIdx > 0 ? 0 : 1;
          }

          // YtD: Jan–currMo of currYr vs Jan–currMo of prevYr
          const { currIdxs: ytdCurrColIdxs, prevIdxs: ytdPrevColIdxs, label: ytdLabel } =
            buildYtdColIdxs(amountCols, momCurrIdx);

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

            const ytdCurr = ytdCurrColIdxs.reduce((s, i) => s + (amountCols[i] ? parseNum(rawRow?.[amountCols[i].colIdx]) : 0), 0);
            const ytdPrev = ytdPrevColIdxs.reduce((s, i) => s + (amountCols[i] ? parseNum(rawRow?.[amountCols[i].colIdx]) : 0), 0);
            const gapYtD  = ytdCurr - ytdPrev;
            const pctYtD  = ytdPrev === 0 ? 0 : (gapYtD / Math.abs(ytdPrev)) * 100;

            // Auto-populate reasons from kode akun lookup
            const acctCode = String(values[accountColIdx] ?? '').trim();
            const acctEntry = acctReasonMap[acctCode];
            const reasonMoM = acctEntry ? [...acctEntry.klasifikasi].join('; ') : '';
            const reasonYoY = acctEntry ? [...acctEntry.remark].join('; ') : '';

            rekapRows.push({ values, type, gapMoM, pctMoM, gapYoY, pctYoY, gapYtD, pctYtD, ytdCurrV: ytdCurr, ytdPrevV: ytdPrev, reasonMoM, reasonYoY, reasonYtD: '' });
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
            ytdCurrColIdxs,
            ytdPrevColIdxs,
            ytdLabel,
            rows: rekapRows,
          };
          setRekapSheetData(rekapData);
        }
      }

      // ── Auto-build rekap from kode akun sheets (when no rekap sheet found) ─
      if (!rekapSheetName && akunPeriodesFlat.length > 0) {
        const autoRekap = buildRekapFromAkunPeriodes(akunPeriodesFlat);
        rekapData = autoRekap;
        setRekapSheetData(autoRekap);
      }

      // ── Save to database ───────────────────────────────────────────────────
      await saveToDatabase(file.name, result, rekapData);

      // ── Save to L1 + L2 cache ───────────────────────────────────────────────────
      _sheetCache = { sheets: result, rekap: rekapData, fileName: file.name };
      idbSaveSheets(_sheetCache); // fire-and-forget

      // ── Save rows per-account to DB (so other users can view without re-uploading) ─
      for (const sd of result) {
        fetch('/api/fluktuasi/sheet-rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountCode:       sd.sheetName,
            headers:           sd.headers,
            originalHeaders:   sd.originalHeaders,
            klasifikasiColIdx: sd.klasifikasiColIdx ?? null,
            docnoColIdx:       sd.docnoColIdx ?? null,
            rows:              sd.rows,
            fileName:          file.name,
          }),
        }).catch(e => console.warn('Failed to save sheet rows to DB', e));
      }

    } catch (err: any) {
      console.error(err);
      setUploadError('Gagal membaca file: ' + (err?.message || err));
      setFileName('');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Download (via API → ExcelJS with full formatting) ────────────────────────
  const [isDownloading, setIsDownloading] = useState(false);

  // ── Generate AI reason for a rekap row (with auto-retry on 429) ──────────
  const generateReason = async (
    rowIdx: number,
    type: 'mom' | 'yoy' | 'ytd' | 'both',
    row: RekapSheetRow,
    accountName: string,
    _retry = 0,
  ): Promise<boolean> => {
    if (!rekapSheetData) return false;
    const key = type === 'both' ? `${rowIdx}-both` : `${rowIdx}-${type}`;
    setAiLoading(prev => ({ ...prev, [key]: true }));
    setAiErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    try {
      const { amountCols, momCurrIdx, momPrevIdx, yoyCurrIdx, yoyPrevIdx } = rekapSheetData;
      const currAmt    = amountCols[momCurrIdx];
      const prevAmt    = amountCols[momPrevIdx];
      const yoyCurrAmt = amountCols[yoyCurrIdx];
      const yoyPrevAmt = amountCols[yoyPrevIdx];
      const periods = amountCols.map(ac => ({
        label: ac.dateLabel || ac.label,
        value: row.values[ac.colIdx],
      }));
      // Extract sub-breakdown (klasifikasi → totalAmount) from matching kode-akun sheet
      const acctCode = String(row.values[rekapSheetData.accountColIdx] ?? '').trim();
      const matchSheet = sheetDataList.find(s => {
        const code = s.sheetName.trim().match(/^(\d{5,})/)?.[1] ?? s.sheetName.trim();
        return code === acctCode || s.sheetName.trim() === acctCode;
      });
      let subBreakdown: { klasifikasi: string; totalAmount: number; count: number }[] = [];
      if (matchSheet) {
        const aggMap = new Map<string, { total: number; count: number }>();
        for (const r of matchSheet.rows) {
          const k = String(r['__klasifikasi'] ?? r['__klasifikasi_raw'] ?? '').trim() || '(Tidak berkategori)';
          const amt = parseNum(r['__amount'] ?? 0);
          const ex = aggMap.get(k) ?? { total: 0, count: 0 };
          aggMap.set(k, { total: ex.total + amt, count: ex.count + 1 });
        }
        subBreakdown = [...aggMap.entries()]
          .map(([klasifikasi, { total, count }]) => ({ klasifikasi, totalAmount: total, count }))
          .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount))
          .slice(0, 12);
      }
      const res = await fetch('/api/fluktuasi/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountCode: acctCode,
          accountName,
          type,
          gapMoM: row.gapMoM,
          pctMoM: row.pctMoM,
          gapYoY: row.gapYoY,
          pctYoY: row.pctYoY,
          currLabel:    currAmt?.dateLabel    || currAmt?.label    || '',
          prevMoMLabel: prevAmt?.dateLabel    || prevAmt?.label    || '',
          prevYoYLabel: yoyPrevAmt?.dateLabel || yoyPrevAmt?.label || '',
          amountPeriods: periods,
          subBreakdown: subBreakdown.length > 0 ? subBreakdown : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Auto-retry with exponential backoff on 429 (max 3 retries: 8s / 16s / 32s)
        if (res.status === 429 && _retry < 3) {
          const waitMs = (2 ** _retry) * 8000;
          setAiErrors(prev => ({ ...prev, [key]: `Rate limit — retry dalam ${waitMs / 1000}s...` }));
          await new Promise(r => setTimeout(r, waitMs));
          setAiLoading(prev => { const n = { ...prev }; delete n[key]; return n; });
          return generateReason(rowIdx, type, row, accountName, _retry + 1);
        }
        const errMsg = res.status === 429
          ? 'Rate limit Gemini. Coba lagi dalam beberapa menit.'
          : res.status === 500 && data.error?.includes('GEMINI_API_KEY')
            ? 'GEMINI_API_KEY belum dikonfigurasi di server.'
            : (data.error || `Error ${res.status}`);
        const affectedKeys = type === 'both' ? [`${rowIdx}-mom`, `${rowIdx}-yoy`] : [key];
        setAiErrors(prev => { const n = { ...prev }; affectedKeys.forEach(k => { n[k] = errMsg; }); return n; });
        return false;
      }
      setAiReasons(prev => ({
        ...prev,
        [rowIdx]: {
          ...prev[rowIdx],
          ...(type !== 'yoy' && type !== 'ytd' ? { mom: data.reasonMoM || data.reason || '' } : {}),
          ...(type !== 'mom' && type !== 'ytd' ? { yoy: data.reasonYoY || data.reason || '' } : {}),
          ...(type === 'ytd' ? { ytd: data.reasonYtD || data.reasonMoM || data.reason || '' } : {}),
        },
      }));
      return true;
    } catch (e) {
      const affectedKeys = type === 'both' ? [`${rowIdx}-mom`, `${rowIdx}-yoy`] : [key];
      setAiErrors(prev => { const n = { ...prev }; affectedKeys.forEach(k => { n[k] = 'Gagal menghubungi server AI.'; }); return n; });
      return false;
    } finally {
      setAiLoading(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const generateAllSequential = async (
    rows: typeof rekapDisplayRows,
    dColIdx: number
  ) => {
    const detailRows = rows
      .map((row, gi) => ({ row, gi }))
      .filter(({ row }) => row.type === 'detail');
    aiCancelRef.current = false;
    setAiBatch({ done: 0, total: detailRows.length });
    let done = 0;
    for (const { row, gi } of detailRows) {
      if (aiCancelRef.current) break;
      const dn = dColIdx >= 0 ? String(row.values[dColIdx] ?? '') : '';
      await generateReason(gi, 'both', row, dn);
      done++;
      setAiBatch({ done, total: detailRows.length });
      if (done < detailRows.length && !aiCancelRef.current) {
        await new Promise(r => setTimeout(r, 4200));
      }
    }
    setAiBatch(null);
  };

  // ── AI Chatbot ──────────────────────────────────────────────────────────────
  const openChat = (globalRi: number, row: RekapSheetRow, accountName: string) => {
    if (!rekapSheetData) return;
    const acctCode = String(row.values[rekapSheetData.accountColIdx] ?? '').trim();
    const { amountCols } = rekapSheetData;
    const periodLines = amountCols
      .map(ac => `${ac.dateLabel || ac.label}: ${fmtRp(parseNum(row.values[ac.colIdx] ?? 0))}`)
      .join('\n');
    const matchSd = sheetDataList.find(s => {
      const code = s.sheetName.trim().match(/^(\d{5,})/)?.[1] ?? s.sheetName.trim();
      return code === acctCode || s.sheetName.trim() === acctCode;
    });
    let breakdownLines = '';
    if (matchSd) {
      const aggMap = new Map<string, number>();
      for (const r of matchSd.rows) {
        const k = String(r['__klasifikasi'] ?? r['__klasifikasi_raw'] ?? '').trim() || '(Tidak berkategori)';
        aggMap.set(k, (aggMap.get(k) ?? 0) + parseNum(r['__amount'] ?? 0));
      }
      breakdownLines = [...aggMap.entries()]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 12)
        .map(([k, v]) => `  ${k}: ${fmtRp(v)}`)
        .join('\n');
    }
    const systemCtx = [
      'Kamu adalah analis keuangan senior perusahaan Indonesia.',
      '',
      `DATA AKUN:\nKode: ${acctCode}\nNama: ${accountName}`,
      '',
      `HISTORI NILAI PER PERIODE:\n${periodLines}`,
      ...(breakdownLines ? ['', `BREAKDOWN KLASIFIKASI TRANSAKSI (periode terkini):\n${breakdownLines}`] : []),
      '',
      'Gunakan data di atas sebagai konteks dalam setiap jawaban. DILARANG mengarang fakta di luar data yang disediakan.',
    ].join('\n');
    setChat({
      open: true, globalRi, accountCode: acctCode, accountName,
      model: OPENROUTER_MODELS[0].id, keyIdx: OPENROUTER_MODELS[0].keyIdx,
      messages: [], input: '', loading: false, systemCtx,
    });
  };

  const sendChatMessage = async () => {
    if (!chat || !chat.input.trim() || chat.loading) return;
    const userMsg: ChatMsg = { role: 'user', content: chat.input.trim() };
    const newMessages = [...chat.messages, userMsg];
    setChat(prev => prev ? { ...prev, messages: newMessages, input: '', loading: true } : prev);
    try {
      const res = await fetch('/api/fluktuasi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chat.model, keyIdx: chat.keyIdx, systemContext: chat.systemCtx, messages: newMessages }),
      });
      const data = await res.json();
      const reply: string = res.ok ? (data.reply || '') : `Error: ${data.error || res.status}`;
      setChat(prev => prev ? { ...prev, loading: false, messages: [...newMessages, { role: 'assistant' as const, content: reply }] } : prev);
    } catch {
      setChat(prev => prev ? { ...prev, loading: false, messages: [...newMessages, { role: 'assistant' as const, content: 'Gagal menghubungi server AI.' }] } : prev);
    }
  };

  const handleDownload = async () => {
    if (!sheetDataList.length && !rekapSheetData) {
      toast.info('Belum ada data. Upload file terlebih dahulu.');
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
      toast.error('Gagal download: ' + (err?.message || err));
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Derived / memoized values ──────────────────────────────────────────────
  const activeSheet = useMemo(() => sheetDataList[activeSheetIdx] ?? null, [sheetDataList, activeSheetIdx]);

  // Available columns for col: dropdown — real headers if data loaded, else SAP defaults
  const availableColumns = useMemo(() => {
    const SAP_DEFAULTS = [
      'Document No.', 'Belegnummer', 'Posting Date', 'Document Date',
      'G/L Account', 'Sachkonto', 'Cost Center', 'Kostenstelle',
      'Profit Center', 'Assignment', 'Zuordnung', 'Text',
      'Document Header Text', 'Reference', 'Amount in LC',
      'Company Code', 'Plant', 'Vendor', 'Customer', 'Material',
    ];
    if (sheetDataList.length > 0) {
      const from = [...new Set(sheetDataList.flatMap(sd => sd.headers).filter(h => !h.startsWith('__')))];
      if (from.length > 0) return from;
    }
    return SAP_DEFAULTS;
  }, [sheetDataList]);

  // Paginated kode-akun rows
  const kaRows = useMemo(() => activeSheet?.rows ?? [], [activeSheet]);
  // True only when row data is actually present (rows are stripped when saved to DB)
  const hasSheetRows = useMemo(() => sheetDataList.some(sd => sd.rows.length > 0), [sheetDataList]);
  const kaTotalPages = Math.ceil(kaRows.length / KA_PAGE_SIZE);
  const kaPageRows   = useMemo(() => kaRows.slice(kaPage * KA_PAGE_SIZE, (kaPage + 1) * KA_PAGE_SIZE), [kaRows, kaPage]);

  // Re-run keyword matching live on the visible KA rows so that keywords added/changed
  // after upload are reflected immediately without needing to re-upload the file.
  const liveKaPageRows = useMemo(() => {
    if (!kaPageRows.length || !keywords.length) return kaPageRows;
    const sheetCode = (activeSheet?.sheetName ?? '').match(/^(\d{5,})/)?.[1] ?? activeSheet?.sheetName ?? '';
    const hdrs      = activeSheet?.headers ?? [];
    // Use stored index; fallback to header-name detection for old DB-loaded data
    const kColIdx = activeSheet?.klasifikasiColIdx ??
      findColIdx(hdrs, ['Document Header Text','Header Text','Doc. Header Text','DocHeaderText',
        'Header Dokumen','Deskripsi Header','Description','Keterangan','Uraian','Narasi','Nama Akun']);
    const dColIdx = activeSheet?.docnoColIdx ??
      findColIdx(hdrs, ['Document No.','Doc. No.','DocNo','Document Number','Belegnummer','Belnr',
        'No. Dokumen','Nomor Dokumen']);
    const scopedKw = keywords.filter(kw => {
      const ac = (kw.accountCodes ?? '').trim();
      if (!ac) return true;
      return ac.split(',').map(s => s.trim()).includes(sheetCode);
    });
    return kaPageRows.map(row => {
      // Prefer __klasifikasi_raw (set at upload); fallback to live header lookup for DB-loaded rows
      const rawK  = String(row['__klasifikasi_raw'] ?? '') ||
                    (kColIdx >= 0 ? String(row[hdrs[kColIdx]] ?? '') : '');
      const rawR  = String(row['__remark_raw']      ?? '') || rawK;
      const docno = String(row['__docno_raw']        ?? '') ||
                    (dColIdx >= 0 ? String(row[hdrs[dColIdx]] ?? '') : '');
      return {
        ...row,
        __klasifikasi: matchKeywords(rawK, scopedKw, 'klasifikasi', docno, row),
        __remark:      matchKeywords(rawR, scopedKw, 'remark',       docno, row),
      } as Record<string, any>;
    });
  }, [kaPageRows, keywords, activeSheet]);

  // Precomputed amountCols set for O(1) lookup per cell
  const amtColMap = useMemo(() => {
    const m = new Map<number, AmountCol>();
    rekapSheetData?.amountCols.forEach((ac) => m.set(ac.colIdx, ac));
    return m;
  }, [rekapSheetData]);

  // Account codes available from the loaded rekap sheet (for the keyword form selector)
  const availableAccountCodes = useMemo(() => {
    const fromRekap = (rekapSheetData?.rows ?? [])
      .filter(r => r.type === 'detail')
      .map(r => String(r.values[rekapSheetData!.accountColIdx] ?? '').trim())
      .filter(c => /^\d{5,}$/.test(c));
    const fromSheets = sheetDataList
      .map(s => s.sheetName.trim())
      .filter(c => /^\d{5,}$/.test(c));
    return [...new Set([...fromRekap, ...fromSheets])].sort();
  }, [rekapSheetData, sheetDataList]);

  // Paginated rekap rows (skip empty)
  const rekapDisplayRows = useMemo(() =>
    (rekapSheetData?.rows ?? []).filter((r) => r.type !== 'empty'),
  [rekapSheetData]);

  // Reactively recompute klasifikasi/remark from current keywords state
  // (so the table updates immediately when keywords are added/edited/deleted)
  const acctReasonMapLive = useMemo(() => {
    const map: Record<string, { klasifikasi: Set<string>; remark: Set<string> }> = {};
    for (const sd of sheetDataList) {
      const code = sd.sheetName.trim();
      // Extract just the numeric part if sheetName has description appended
      const numCode = code.match(/^(\d{5,})/)?.[1] ?? code;
      // Only use keywords that either have no accountCodes restriction, or include this code
      const scopedKw = keywords.filter(kw => {
        const ac = (kw.accountCodes ?? '').trim();
        if (!ac) return true;
        return ac.split(',').map(s => s.trim()).includes(numCode);
      });
      const kSet = new Set<string>();
      const rSet = new Set<string>();
      for (const row of sd.rows) {
        const rawK  = String(row['__klasifikasi_raw'] ?? row['__klasifikasi'] ?? '');
        const rawR  = String(row['__remark_raw']      ?? rawK); // same source as klasifikasi
        const docno = String(row['__docno_raw']        ?? '');
        const k = matchKeywords(rawK, scopedKw, 'klasifikasi', docno, row);
        const r = matchKeywords(rawR, scopedKw, 'remark',       docno, row);
        if (k) kSet.add(k);
        if (r) rSet.add(r);
      }
      map[code] = { klasifikasi: kSet, remark: rSet };
      // Also store under the numeric-only key so rekap lookup (acctIdx) always hits
      if (numCode !== code) map[numCode] = { klasifikasi: kSet, remark: rSet };
    }
    return map;
  }, [sheetDataList, keywords]);

  // Overlay live reasonMoM/reasonYoY + recompute GAP/PCT from selected periods
  const rekapDisplayRowsLive = useMemo(() => {
    if (!rekapSheetData) return rekapDisplayRows;
    const ac      = rekapSheetData.amountCols;
    const acctIdx = rekapSheetData.accountColIdx;
    const momCI   = momSel?.curr ?? rekapSheetData.momCurrIdx;
    const momPI   = momSel?.prev ?? rekapSheetData.momPrevIdx;
    const yoyCI   = yoySel?.curr ?? rekapSheetData.yoyCurrIdx;
    const yoyPI   = yoySel?.prev ?? rekapSheetData.yoyPrevIdx;

    return rekapDisplayRows.map(row => {
      // ── Always recompute GAP/PCT from effective period indices ──
      // (do not rely on baked-in values from parse time; those may be wrong
      //  if column auto-detection picked the same index for curr and prev)
      const curr    = ac[momCI]  ? parseNum(row.values[ac[momCI].colIdx])  : 0;
      const prev    = ac[momPI]  ? parseNum(row.values[ac[momPI].colIdx])  : 0;
      const yoyCurr = ac[yoyCI]  ? parseNum(row.values[ac[yoyCI].colIdx])  : 0;
      const yoyPrev = ac[yoyPI]  ? parseNum(row.values[ac[yoyPI].colIdx])  : 0;
      const gapMoM  = curr - prev;
      const pctMoM  = prev === 0 ? 0 : (gapMoM / Math.abs(prev)) * 100;
      const gapYoY  = yoyCurr - yoyPrev;
      const pctYoY  = yoyPrev === 0 ? 0 : (gapYoY / Math.abs(yoyPrev)) * 100;

      // Recompute YtD — respect ytdSel if set, else fall back to stored column-index sets
      // Helper: get YtD value for a single amountCols index (colIdx of the target "Up to" period).
      // If the column is cumulative → use its value directly.
      // If point-in-time → sum all non-cumulative same-year cols from Jan → mo.
      const getYtdVal = (targetIdx: number): number => {
        const tAC = ac[targetIdx];
        if (!tAC) return 0;
        if (tAC.isCumulative) return parseNum(row.values[tAC.colIdx]);
        // Point-in-time: sum Jan → target month within same year
        const YTDMM: Record<string, number> = {
          jan:1,feb:2,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,aug:8,agu:8,sep:9,oct:10,okt:10,nov:11,dec:12,des:12,
        };
        const getMoNum = (a: AmountCol) => {
          const db = a.label.match(/^20\d{2}\.(\d{2})$/);
          if (db) return parseInt(db[1]);
          const txt = (a.dateLabel + ' ' + a.label).toLowerCase();
          for (const [k, v] of Object.entries(YTDMM)) if (new RegExp(`\\b${k}\\b`).test(txt)) return v;
          return 0;
        };
        const tMo  = getMoNum(tAC);
        const tYr  = tAC.yearLabel.match(/20\d{2}/)?.[0] ?? '';
        if (!tMo || !tYr) return parseNum(row.values[tAC.colIdx]);
        return ac.reduce((sum, a, _i) => {
          if (a.isCumulative) return sum;
          if ((a.yearLabel.match(/20\d{2}/)?.[0] ?? '') !== tYr) return sum;
          const mo = getMoNum(a);
          return (mo >= 1 && mo <= tMo) ? sum + parseNum(row.values[a.colIdx]) : sum;
        }, 0);
      };
      let ytdCurrV: number, ytdPrevV: number;
      if (ytdSel) {
        ytdCurrV = getYtdVal(ytdSel.curr);
        ytdPrevV = getYtdVal(ytdSel.prev);
      } else {
        const ytdCI  = rekapSheetData.ytdCurrColIdxs ?? [];
        const ytdPI  = rekapSheetData.ytdPrevColIdxs ?? [];
        ytdCurrV = ytdCI.reduce((s, i) => s + (ac[i] ? parseNum(row.values[ac[i].colIdx]) : 0), 0);
        ytdPrevV = ytdPI.reduce((s, i) => s + (ac[i] ? parseNum(row.values[ac[i].colIdx]) : 0), 0);
      }
      const gapYtD  = ytdCurrV - ytdPrevV;
      const pctYtD  = ytdPrevV === 0 ? 0 : (gapYtD / Math.abs(ytdPrevV)) * 100;

      let updated: RekapSheetRow = { ...row, gapMoM, pctMoM, gapYoY, pctYoY, gapYtD, pctYtD, ytdCurrV: ytdCurrV, ytdPrevV: ytdPrevV };

      // ── Overlay klasifikasi/remark from live keywords ──
      if (sheetDataList.length && row.type === 'detail') {
        const acct  = String(row.values[acctIdx] ?? '').trim();
        const entry = acctReasonMapLive[acct];
        if (entry) updated = {
          ...updated,
          reasonMoM: [...entry.klasifikasi].join('; '),
          reasonYoY: [...entry.remark].join('; '),
        };
      }
      return updated;
    });
  }, [rekapDisplayRows, acctReasonMapLive, rekapSheetData, sheetDataList, momSel, yoySel, ytdSel]);

  const rekapTotalPages = Math.ceil(rekapDisplayRowsLive.length / REKAP_PAGE_SIZE);
  const rekapPageRows   = useMemo(() =>
    rekapDisplayRowsLive.slice(rekapPage * REKAP_PAGE_SIZE, (rekapPage + 1) * REKAP_PAGE_SIZE),
  [rekapDisplayRowsLive, rekapPage]);

  // Reset pages when switching tabs
  const switchRef = useRef<SheetData[]>([]);
  useEffect(() => { switchRef.current = sheetDataList; }, [sheetDataList]);
  const switchTab = useCallback((idx: number) => {
    setActiveSheetIdx(idx);
    setKaPage(0);
    const target = switchRef.current[idx];
    if (target && target.rows.length === 0) {
      hydrateSheetRows(idx, target.sheetName);
    }
  }, [hydrateSheetRows]);

  // Auto-scroll active tab into view when activeSheetIdx changes
  const tabBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tabBarRef.current) return;
    const btn = tabBarRef.current.children[activeSheetIdx] as HTMLElement | undefined;
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeSheetIdx]);

  // ── GSAP sheet-tab switch: slide table content in from the side ────────────
  const prevSheetIdxRef = useRef(-1);
  useEffect(() => {
    if (!kaTableRef.current) return;
    const prev = prevSheetIdxRef.current;
    prevSheetIdxRef.current = activeSheetIdx;
    if (prev < 0) return; // first mount, skip
    const dir = activeSheetIdx > prev ? 1 : -1;
    gsap.fromTo(
      kaTableRef.current,
      { opacity: 0, x: dir * 28 },
      { opacity: 1, x: 0, duration: 0.22, ease: 'power2.out' },
    );
  }, [activeSheetIdx]);

  // ── GSAP chat modal entrance (fires whenever chat opens) ─────────────
  const chatWasOpenRef = useRef(false);
  useEffect(() => {
    if (!chat?.open) { chatWasOpenRef.current = false; return; }
    if (chatWasOpenRef.current) return; // already animated
    chatWasOpenRef.current = true;
    // backdrop fade-in
    if (chatBackdropRef.current) {
      gsap.fromTo(chatBackdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.25, ease: 'power1.out' },
      );
    }
    // card scale + slide up
    if (chatModalRef.current) {
      gsap.fromTo(chatModalRef.current,
        { opacity: 0, scale: 0.88, y: 36 },
        { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.4)', delay: 0.05 },
      );
    }
  }, [chat?.open]);

  // ── GSAP page entrance animation ─────────────────────────────────────────
  useEffect(() => {
    if (!pageContentRef.current) return;
    const cards = pageContentRef.current.querySelectorAll('[data-animate-card]');
    if (cards.length === 0) return;
    gsap.set(cards, { opacity: 0, y: 40 });
    gsap.to(cards, {
      opacity: 1,
      y: 0,
      duration: 0.65,
      ease: 'power3.out',
      stagger: 0.1,
      delay: 0.05,
    });
  }, []);

  // ── GSAP keyword rows stagger (fires whenever page/filter changes) ────────
  useEffect(() => {
    if (!keywordBodyRef.current) return;
    const rows = Array.from(keywordBodyRef.current.querySelectorAll('tr.js-kw-row')) as HTMLElement[];
    if (rows.length === 0) return;
    if (rows.length <= 20) {
      gsap.fromTo(rows,
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.3, ease: 'power3.out', stagger: 0.03 }
      );
    } else {
      // For large sets just do a single quick fade — stagger would take too long
      gsap.fromTo(rows, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' });
    }
  }, [keywordPage, keywordFilter, keywordSearch, keywordAkunSearch]);

  // ── GSAP rekap rows fade (fires on page/data change) ─────────────────────
  // NOTE: stagger removed — with REKAP_PAGE_SIZE=200 a 0.012s stagger means
  // the last row starts 2.4 s after page turn, making the table feel very slow.
  useEffect(() => {
    if (!rekapBodyRef.current) return;
    const rows = Array.from(rekapBodyRef.current.querySelectorAll('tr.js-rekap-row')) as HTMLElement[];
    if (rows.length === 0) return;
    if (rows.length <= 25) {
      gsap.fromTo(rows,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out', stagger: 0.01 }
      );
    } else {
      // Single batch fade — instant table appearance for large pages
      gsap.fromTo(rows, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power1.out' });
    }
  }, [rekapPage]);

  // ── Modal entrance: GSAP backdrop + container, anime.js form fields ────────
  useEffect(() => {
    if (!showKeywordModal) return;

    // 1. GSAP — backdrop fade in
    if (modalBackdropRef.current) {
      gsap.fromTo(modalBackdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.22, ease: 'power1.out' }
      );
    }

    // 2. GSAP — modal card scale + slide in
    if (modalRef.current) {
      gsap.fromTo(modalRef.current,
        { opacity: 0, scale: 0.9, y: 28 },
        { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: 'power3.out', delay: 0.04 }
      );
    }

    // 3. anime.js — stagger every direct child section in the form body
    // Runs after the card finishes sliding in
    const timer = setTimeout(() => {
      if (!modalFormBodyRef.current) return;
      const fields = Array.from(modalFormBodyRef.current.children) as HTMLElement[];
      if (fields.length === 0) return;
      // Reset to invisible first so stagger is visible even if already rendered
      fields.forEach(el => { el.style.opacity = '0'; el.style.transform = 'translateY(14px)'; });
      animeAnimate(fields, {
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 340,
        delay: animeStagger(55, { start: 0 }),
        ease: 'easeOutExpo',
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [showKeywordModal]);

  // ── GSAP DB stats badges ──────────────────────────────────────────────────
  useEffect(() => {
    if (!dbStatsRef.current || !dbPeriodeStats) return;
    const badges = Array.from(dbStatsRef.current.querySelectorAll('.js-periode-badge')) as HTMLElement[];
    if (badges.length === 0) return;
    gsap.fromTo(badges,
      { opacity: 0, scale: 0.6 },
      { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.7)', stagger: 0.025, delay: 0.08 }
    );
  }, [dbPeriodeStats]);

  // ── GSAP upload processing overlay ───────────────────────────────────────
  useEffect(() => {
    const el = document.getElementById('upload-processing-bar');
    if (!el) return;
    if (isProcessing) {
      gsap.fromTo(el, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.4, ease: 'power2.out', transformOrigin: 'left' });
    }
  }, [isProcessing]);

  // ── Filtered & sorted keyword list (shared by table body + pagination) ───
  const filteredKeywords = useMemo(() =>
    keywords
      .filter(kw => keywordFilter === 'all' || kw.type === keywordFilter)
      .filter(kw => {
        if (!keywordSearch) return true;
        const search = keywordSearch.toLowerCase();
        return kw.keyword.toLowerCase().includes(search) || kw.result.toLowerCase().includes(search);
      })
      .filter(kw => {
        if (!keywordAkunSearch) return true;
        const akunSearch = keywordAkunSearch.toLowerCase();
        return kw.accountCodes.toLowerCase().includes(akunSearch);
      })
      .sort((a, b) => b.id - a.id),
  [keywords, keywordFilter, keywordSearch, keywordAkunSearch]);

  // ── Parse natural language preview (avoid re-running on every unrelated render) ──
  const parsedNaturalInput = useMemo(
    () => parseNaturalKeyword(naturalInput),
    [naturalInput],
  );

  // ── Pre-compute template reasons for rekap rows ───────────────────────────
  // Keyed by index into rekapDisplayRowsLive so AI state changes (aiReasons/
  // aiLoading) don't trigger expensive buildTemplateReason re-runs.
  const rekapTemplateReasons = useMemo(() => {
    if (!rekapSheetData) return new Map<number, { mom: string; yoy: string; ytd: string }>();
    const { accountColIdx, amountCols, momCurrIdx, momPrevIdx, yoyCurrIdx, yoyPrevIdx } = rekapSheetData;
    const effMC = momSel?.curr ?? momCurrIdx;
    const effMP = momSel?.prev ?? momPrevIdx;
    const effYC = yoySel?.curr ?? yoyCurrIdx;
    const effYP = yoySel?.prev ?? yoyPrevIdx;
    const _ytdCI0 = rekapSheetData.ytdCurrColIdxs ?? [];
    const _ytdPI0 = rekapSheetData.ytdPrevColIdxs ?? [];
    const effYtdC = ytdSel?.curr ?? (_ytdCI0.length > 0 ? _ytdCI0[_ytdCI0.length - 1] : momCurrIdx);
    const effYtdP = ytdSel?.prev ?? (_ytdPI0.length > 0 ? _ytdPI0[_ytdPI0.length - 1] : yoyPrevIdx);
    // Compute descColIdx (same logic as in the render IIFE)
    const amtColSet = new Set(amountCols.map((ac) => ac.colIdx));
    const firstAmtIdx = amountCols.length > 0 ? Math.min(...amountCols.map((ac) => ac.colIdx)) : Infinity;
    const descColIdx = rekapSheetData.headers
      .map((_, ci) => ci)
      .find((ci) => {
        if (ci === accountColIdx || amtColSet.has(ci) || ci >= firstAmtIdx) return false;
        return rekapSheetData.rows.some((r) => String(r.values[ci] ?? '').trim() !== '');
      }) ?? -1;
    const map = new Map<number, { mom: string; yoy: string; ytd: string }>();
    rekapDisplayRowsLive.forEach((row, idx) => {
      if (row.type !== 'detail') return;
      const descVal = descColIdx >= 0 ? String(row.values[descColIdx] ?? '') : '';
      const mom = Math.abs(row.gapMoM) !== 0
        ? buildTemplateReason(row.gapMoM, row.pctMoM, descVal, 'mom', amountCols, row.values, effMC, effMP)
        : '';
      const yoy = Math.abs(row.gapYoY) !== 0
        ? buildTemplateReason(row.gapYoY, row.pctYoY, descVal, 'yoy', amountCols, row.values, effYC, effYP)
        : '';
      const ytd = Math.abs(row.gapYtD) !== 0
        ? buildTemplateReason(row.gapYtD, row.pctYtD, descVal, 'yoy', amountCols, row.values, effYtdC, effYtdP)
        : '';
      map.set(idx, { mom, yoy, ytd });
    });
    return map;
  }, [rekapDisplayRowsLive, rekapSheetData, momSel, yoySel, ytdSel]);

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

        <div ref={pageContentRef} className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6">

          {/* ── Master Keywords Card ───────────────────────────────────────── */}
          <div data-animate-card className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowKeywordSection(v => !v)}
              className="w-full p-5 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Master Keywords</h2>
                <p className="text-sm text-gray-500 mt-1">Kelola keyword untuk klasifikasi dan remark - digunakan otomatis saat upload file</p>
              </div>
              <ChevronDown
                size={20}
                className={`text-gray-400 transition-transform duration-200 ${showKeywordSection ? 'rotate-180' : ''}`}
              />
            </button>
            {showKeywordSection && (
            <div className="border-t border-gray-200">
            <div className="p-5 border-b border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div />
                <div className="flex gap-2 flex-wrap">
                  {keywords.length === 0 && (
                    <button
                      onClick={handleLoadExamples}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                    >
                      <Download size={16} />
                      Load Contoh
                    </button>
                  )}
                  {keywords.length > 0 && (
                    <>
                      <button
                        onClick={handleReapplyKeywords}
                        disabled={isReapplying}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Re-proses klasifikasi seluruh data tersimpan menggunakan keyword saat ini"
                      >
                        <RotateCcw size={16} className={isReapplying ? 'animate-spin' : ''} />
                        {isReapplying ? 'Memproses...' : 'Re-terapkan ke DB'}
                      </button>
                      <button
                        onClick={handleDeleteAllKeywords}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
                      >
                        <Trash2 size={16} />
                        Hapus Semua
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setEditingKeyword(null);
                      setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0, accountCodes: '', sourceColumn: '' });
                      setKwMode('normal');
                      setColHeader('');
                      setColPattern('');
                      setInputMode('simple');
                      setNaturalInput('');
                      setShowKeywordModal(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                  >
                    <span className="text-lg">+</span>
                    Tambah Keyword
                  </button>
                </div>
              </div>

              {keywords.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => { setKeywordFilter('all'); setKeywordPage(0); }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                        keywordFilter === 'all'
                          ? 'bg-gray-700 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      Semua ({keywords.length})
                    </button>
                    <button
                      onClick={() => { setKeywordFilter('klasifikasi'); setKeywordPage(0); }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                        keywordFilter === 'klasifikasi'
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                      }`}
                    >
                      Klasifikasi ({keywords.filter(k => k.type === 'klasifikasi').length})
                    </button>
                    <button
                      onClick={() => { setKeywordFilter('remark'); setKeywordPage(0); }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                        keywordFilter === 'remark'
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                      }`}
                    >
                      Remark ({keywords.filter(k => k.type === 'remark').length})
                    </button>
                  </div>
                  
                  {/* Search Box */}
                  <div className="mt-3 flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[180px] max-w-sm">
                      <input
                        type="text"
                        value={keywordSearch}
                        onChange={(e) => { setKeywordSearch(e.target.value); setKeywordPage(0); }}
                        placeholder="Cari keyword / result..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>
                    <div className="flex-1 min-w-[180px] max-w-sm">
                      <input
                        type="text"
                        value={keywordAkunSearch}
                        onChange={(e) => { setKeywordAkunSearch(e.target.value); setKeywordPage(0); }}
                        placeholder="Cari berdasarkan G/L Account..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-orange-400 text-sm"
                      />
                    </div>
                  </div>
                  {(keywordSearch || keywordAkunSearch) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Menampilkan {filteredKeywords.length} dari {keywords.filter(kw => keywordFilter === 'all' || kw.type === keywordFilter).length} keyword
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Result/Output
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Berlaku di Akun
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Cek di Kolom
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody ref={keywordBodyRef as React.Ref<HTMLTableSectionElement>} className="divide-y divide-gray-200">
                  {(() => {
                    if (keywords.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center">
                            <div className="text-gray-400 mb-2">
                              <FileSpreadsheet className="mx-auto mb-2" size={40} />
                            </div>
                            <p className="text-sm text-gray-500">Belum ada keyword.</p>
                            <p className="text-xs text-gray-400 mt-1">Klik "Tambah Keyword" atau "Load Contoh" untuk mulai.</p>
                          </td>
                        </tr>
                      );
                    }
                    
                    if (filteredKeywords.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center">
                            <p className="text-sm text-gray-500">Tidak ada keyword yang cocok dengan pencarian.</p>
                            <p className="text-xs text-gray-400 mt-1">Coba kata kunci pencarian lain atau ubah filter.</p>
                          </td>
                        </tr>
                      );
                    }
                    
                    // Pagination
                    const startIdx = keywordPage * KEYWORD_PAGE_SIZE;
                    const endIdx = startIdx + KEYWORD_PAGE_SIZE;
                    const paginatedKeywords = filteredKeywords.slice(startIdx, endIdx);
                    
                    return paginatedKeywords.map((kw, index) => {
                      const isRegex = kw.keyword.toLowerCase().startsWith('regex:');
                      const isNot   = kw.keyword.toLowerCase().startsWith('not:');
                      const isDocno = kw.keyword.toLowerCase().startsWith('docno:');
                      const isCol   = kw.keyword.toLowerCase().startsWith('col:');
                      // For col: display, split col:Header:Pattern into header+pattern
                      const colDisplay = (() => {
                        if (!isCol) return '';
                        const without = kw.keyword.slice(4);
                        const ci = without.indexOf(':');
                        if (ci < 0) return without;
                        return without.slice(0, ci) + ' → ' + without.slice(ci + 1);
                      })();
                      return (
                        <tr key={kw.id} className={`js-kw-row ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isRegex && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 font-mono">regex</span>
                              )}
                              {isNot && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">NOT</span>
                              )}
                              {isDocno && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 font-mono">doc#</span>
                              )}
                              {isCol && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-700 font-mono">col</span>
                              )}
                              <span className="font-mono text-xs">
                                {isRegex ? kw.keyword.slice(6).trim()
                                  : isNot   ? kw.keyword.slice(4).trim()
                                  : isDocno ? kw.keyword.slice(6).trim()
                                  : isCol   ? colDisplay
                                  : kw.keyword}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                              kw.type === 'klasifikasi' 
                                ? 'bg-blue-100 text-blue-800' 
                                : 'bg-purple-100 text-purple-800'
                            }`}>
                              {kw.type === 'klasifikasi' ? 'Klasifikasi' : 'Remark'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {kw.result || <span className="text-gray-400 italic">{isRegex ? '{match}' : '—'}</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                              {kw.priority}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {kw.accountCodes
                              ? kw.accountCodes.split(',').filter(Boolean).map(c => (
                                  <span key={c} className="inline-flex px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono mr-1 mb-1">{c.trim()}</span>
                                ))
                              : <span className="text-gray-400 italic">Semua</span>}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {kw.sourceColumn
                              ? <span className="inline-flex px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono">{kw.sourceColumn}</span>
                              : <span className="text-gray-400 italic">Otomatis</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleEditKeyword(kw)}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-xs font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteKeyword(kw.id)}
                                className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-xs font-medium"
                              >
                                Hapus
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  })()}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Controls */}
            {(() => {
              const totalPages = Math.ceil(filteredKeywords.length / KEYWORD_PAGE_SIZE);
              
              if (totalPages <= 1) return null;
              
              const maxVisiblePages = 5;
              let startPage = Math.max(0, keywordPage - Math.floor(maxVisiblePages / 2));
              let endPage = Math.min(totalPages - 1, startPage + maxVisiblePages - 1);
              
              if (endPage - startPage < maxVisiblePages - 1) {
                startPage = Math.max(0, endPage - maxVisiblePages + 1);
              }
              
              const pages = [];
              for (let i = startPage; i <= endPage; i++) {
                pages.push(i);
              }
              
              return (
                <div className="px-5 py-4 border-t border-gray-200 bg-gray-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs sm:text-sm text-gray-600">
                      Menampilkan {keywordPage * KEYWORD_PAGE_SIZE + 1}–{Math.min((keywordPage + 1) * KEYWORD_PAGE_SIZE, filteredKeywords.length)} dari {filteredKeywords.length} keyword
                    </p>
                    <div className="flex items-center gap-1">
                      {/* First Page */}
                      {keywordPage > 0 && (
                        <button
                          onClick={() => setKeywordPage(0)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition"
                        >
                          ««
                        </button>
                      )}
                      
                      {/* Previous */}
                      {keywordPage > 0 && (
                        <button
                          onClick={() => setKeywordPage(keywordPage - 1)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition"
                        >
                          ‹
                        </button>
                      )}
                      
                      {/* Start ellipsis */}
                      {startPage > 0 && (
                        <span className="px-2 text-gray-500">...</span>
                      )}
                      
                      {/* Page Numbers */}
                      {pages.map((page) => (
                        <button
                          key={page}
                          onClick={() => setKeywordPage(page)}
                          className={`px-3 py-1.5 text-sm border rounded-md transition ${
                            page === keywordPage
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {page + 1}
                        </button>
                      ))}
                      
                      {/* End ellipsis */}
                      {endPage < totalPages - 1 && (
                        <span className="px-2 text-gray-500">...</span>
                      )}
                      
                      {/* Next */}
                      {keywordPage < totalPages - 1 && (
                        <button
                          onClick={() => setKeywordPage(keywordPage + 1)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition"
                        >
                          ›
                        </button>
                      )}
                      
                      {/* Last Page */}
                      {keywordPage < totalPages - 1 && (
                        <button
                          onClick={() => setKeywordPage(totalPages - 1)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition"
                        >
                          »»
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
            </div>
            )}
          </div>

          {/* ── Upload Card ──────────────────────────────────────────────── */}
          <div data-animate-card className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowUploadSection(v => !v)}
              className="w-full p-5 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50 transition-colors text-left"
            >
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
              <ChevronDown
                size={20}
                className={`text-gray-400 transition-transform duration-200 ${showUploadSection ? 'rotate-180' : ''}`}
              />
            </button>

            {showUploadSection && (
              <div className="px-5 pb-5 border-t border-gray-200 pt-4">
                <div className="flex justify-end mb-4">
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

                <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-300 ${
                  isProcessing
                    ? 'border-indigo-400 bg-indigo-50 scale-[0.99]'
                    : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 hover:scale-[1.01]'
                }`}>
                  <Upload className="text-gray-400 mb-2" size={28} />
                  <p className="text-sm text-gray-500">
                    <span className="font-semibold text-gray-700">{fileName || 'Klik untuk upload'}</span>{' '}
                    {!fileName && 'atau drag & drop'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">.xlsx / .xls</p>
                  <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} disabled={isProcessing} />
                </label>

                {isProcessing && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-center gap-3 text-sm text-indigo-700 font-medium">
                      <Loader2 size={18} className="animate-spin text-indigo-600" />
                      Memproses file…
                    </div>
                    <div id="upload-processing-bar" className="w-full">
                      <Progress value={30} className="h-1.5 animate-pulse bg-indigo-100" />
                    </div>
                    <div className="flex gap-2">
                      <Skeleton className="h-3 w-1/3 rounded" />
                      <Skeleton className="h-3 w-1/4 rounded" />
                      <Skeleton className="h-3 w-1/5 rounded" />
                    </div>
                  </div>
                )}
                {uploadError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700">
                    <span className="font-semibold">Gagal memproses:</span> {uploadError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Data Tersimpan (Multi-Periode) ────────────────────────── */}
          <div data-animate-card className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Data Tersimpan (Multi-Periode)</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Setiap upload otomatis menyimpan agregat per kode akun per periode.
                  Klik periode untuk memilih, lalu bangun rekap atau hapus periode yang salah.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={loadAndBuildRekapFromDB}
                  disabled={loadingDbRekap || selectedPeriodes.size === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition text-sm font-medium disabled:opacity-50"
                >
                  {loadingDbRekap
                    ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Memuat…</>
                    : dbPeriodeStats && selectedPeriodes.size < dbPeriodeStats.periodes.length
                      ? <><FileSpreadsheet size={16} />Bangun Rekap ({selectedPeriodes.size} Periode)</>
                      : <><FileSpreadsheet size={16} />Bangun Rekap dari Semua Periode</>
                  }
                </button>
                {dbPeriodeStats && selectedPeriodes.size > 0 && selectedPeriodes.size < dbPeriodeStats.periodes.length && (
                  <button
                    onClick={deleteSelectedPeriodes}
                    disabled={loadingDbRekap}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition text-sm font-medium disabled:opacity-50"
                  >
                    <Trash2 size={16} />Hapus Periode Terpilih
                  </button>
                )}
                <button
                  onClick={clearDbData}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
                >
                  <Trash2 size={16} />Hapus Semua Data DB
                </button>
              </div>
            </div>

            {loadingDbRekap ? (
              <div className="px-5 pb-5 space-y-3">
                <div className="flex gap-3">
                  <Skeleton className="h-9 w-28 rounded-lg" />
                  <Skeleton className="h-9 w-36 rounded-lg" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-16 rounded-full" />)}
                </div>
              </div>
            ) : dbPeriodeStats ? (
              <div ref={dbStatsRef} className="px-5 pb-5">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                    <Sparkles size={14} className="text-teal-500" />
                    <span className="font-semibold text-teal-800">{dbPeriodeStats.accounts}</span>
                    <span className="text-teal-600">kode akun</span>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                    <Sparkles size={14} className="text-indigo-500" />
                    <span className="font-semibold text-indigo-800">
                      {selectedPeriodes.size === dbPeriodeStats.periodes.length
                        ? dbPeriodeStats.periodes.length
                        : `${selectedPeriodes.size} / ${dbPeriodeStats.periodes.length}`}
                    </span>
                    <span className="text-indigo-600">periode tersimpan</span>
                  </div>
                  {/* Pilih semua / batal pilih */}
                  {selectedPeriodes.size === dbPeriodeStats.periodes.length ? (
                    <button
                      onClick={() => setSelectedPeriodes(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
                    >
                      Batal Pilih Semua
                    </button>
                  ) : (
                    <button
                      onClick={() => setSelectedPeriodes(new Set(dbPeriodeStats.periodes))}
                      className="text-xs text-teal-600 hover:text-teal-800 underline underline-offset-2 transition-colors"
                    >
                      Pilih Semua
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {dbPeriodeStats.periodes.map((p) => {
                    const isSelected = selectedPeriodes.has(p);
                    const label = formatPeriodeLabel(p);
                    return (
                      <button
                        key={p}
                        onClick={() => togglePeriode(p)}
                        title={isSelected ? `Klik untuk batal pilih ${label}` : `Klik untuk pilih ${label}`}
                        className={`js-periode-badge inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-teal-100 text-teal-800 border-teal-300 hover:bg-teal-200'
                            : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200 line-through'
                        }`}
                      >
                        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                {selectedPeriodes.size === 0 && (
                  <p className="mt-2 text-xs text-amber-600">Pilih minimal satu periode untuk membangun rekap atau menghapus.</p>
                )}
              </div>
            ) : (
              <div className="px-5 pb-5 text-sm text-gray-400 italic">
                Belum ada data tersimpan. Upload file untuk mulai mengumpulkan data per periode.
              </div>
            )}
          </div>

          {/* ── Legend ───────────────────────────────────────────────────── */}
          {(sheetDataList.length > 0 || rekapSheetData) && (
            <div data-animate-card className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
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
          {!hasSheetRows && dbPeriodeStats && !isProcessing && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <span className="font-semibold">Data detail tidak tersedia.</span>{' '}
              Data ringkasan sudah tersimpan ({dbPeriodeStats.accounts} akun, {dbPeriodeStats.periodes.length} periode),
              tapi data rekap dan detail baris tidak dapat dimuat dari database.
              Silakan upload ulang file Excel.
            </div>
          )}
          {hasSheetRows && (
            <div data-animate-card ref={tableResultRef} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center border-b border-gray-200 bg-gray-50">
                <button className="flex-shrink-0 px-2 py-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  disabled={activeSheetIdx === 0} onClick={() => switchTab(Math.max(0, activeSheetIdx - 1))}>
                  <ChevronLeft size={16} />
                </button>
                <div ref={tabBarRef} className="flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
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
                <div ref={kaTableRef}>
                  <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-500 flex flex-wrap items-center gap-3">
                    <span>G/L Account: <span className="font-semibold text-gray-800">{activeSheet.sheetName}</span></span>
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
                          <th className="px-2 py-2 text-center font-semibold text-white whitespace-nowrap"
                            style={{ backgroundColor: '#4472C4', border: '1px solid #3a62a8', minWidth: 36, position: 'sticky', left: 0, zIndex: 2 }}>No.</th>
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
                        {liveKaPageRows.map((row, ri) => {
                          const globalRi = kaPage * KA_PAGE_SIZE + ri;
                          const rowBg = globalRi % 2 === 0 ? '#ffffff' : '#eff6ff';
                          const addBg = globalRi % 2 === 0 ? '#fff5f5' : '#fff0f0';
                          return (
                          <tr key={ri} style={{ backgroundColor: rowBg }}>
                            <td className="px-2 py-1.5 text-center text-gray-400 whitespace-nowrap select-none"
                              style={{ border: '1px solid #e5e7eb', position: 'sticky', left: 0, zIndex: 1, backgroundColor: rowBg }}>{globalRi + 1}</td>
                            {activeSheet.headers.map((h) => {
                              const val = row[h];
                              const isDateCol = /date|tanggal|tgl/i.test(h);
                              const isAmountCol = /amount|amt|nilai|jumlah/i.test(h);
                              let display: React.ReactNode = val ?? '';
                              if (isDateCol && typeof val === 'number' && val > 40000 && val < 70000) {
                                display = excelSerialToDateStr(val);
                              } else if (isAmountCol && typeof val === 'number') {
                                display = val.toLocaleString('id-ID');
                              }
                              return (
                                <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap"
                                  style={{ border: '1px solid #e5e7eb' }}>{display}</td>
                              );
                            })}
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
                </div>
              )}
            </div>
          )}

          {/* ── Rekap Sheet Table ─────────────────────────────────────────── */}
          {rekapSheetData && (() => {
            const { accountColIdx, amountCols, momCurrIdx, momPrevIdx, yoyCurrIdx, yoyPrevIdx } = rekapSheetData;
            // Compute effective YtD column indices + display labels for the dynamic YtD value columns
            const _ytdCI0   = rekapSheetData.ytdCurrColIdxs ?? [];
            const _ytdPI0   = rekapSheetData.ytdPrevColIdxs ?? [];
            const hasYtdData = _ytdCI0.length > 0 || ytdSel !== null;
            const effYtdCIdx = ytdSel?.curr ?? (_ytdCI0.length > 0 ? _ytdCI0[_ytdCI0.length - 1] : momCurrIdx);
            const effYtdPIdx = ytdSel?.prev ?? (_ytdPI0.length > 0 ? _ytdPI0[_ytdPI0.length - 1] : yoyPrevIdx);
            const effYtdCAC  = amountCols[effYtdCIdx];
            const effYtdPAC  = amountCols[effYtdPIdx];
            const ytdCLabel  = effYtdCAC ? `${effYtdCAC.yearLabel ? effYtdCAC.yearLabel + ' ' : ''}${effYtdCAC.dateLabel}`.trim() : '';
            const ytdPLabel  = effYtdPAC ? `${effYtdPAC.yearLabel ? effYtdPAC.yearLabel + ' ' : ''}${effYtdPAC.dateLabel}`.trim() : '';
            // Columns visible in the table — cumulative (Up-to) cols hidden by default;
            // they're replaced by the dynamic YtD value columns above
            const visibleAmountCols = visibleAmtColIdxs === null
              ? amountCols.filter(ac => !ac.isCumulative)
              : amountCols.filter((_, i) => visibleAmtColIdxs.has(i));
            const amtColSet  = new Set(amountCols.map(ac => ac.colIdx));
            // Find description columns: non-account, non-amount, before first amount col, AND have data
            const firstAmtIdx = amountCols.length > 0 ? Math.min(...amountCols.map(ac => ac.colIdx)) : Infinity;
            const descColIdxList = rekapSheetData.headers
              .map((_, ci) => ci)
              .filter(ci => {
                if (ci === accountColIdx || amtColSet.has(ci) || ci >= firstAmtIdx) return false;
                // Only include columns that have at least one non-empty value in data rows
                return rekapSheetData.rows.some(r => {
                  const v = String(r.values[ci] ?? '').trim();
                  return v !== '';
                });
              });
            const descColIdx = descColIdxList[0] ?? -1;
            const prevAmt    = amountCols[momSel?.prev ?? momPrevIdx];
            const yoyPrev    = amountCols[yoySel?.prev ?? yoyPrevIdx];
            const prevLabel  = prevAmt?.dateLabel  || prevAmt?.label  || '';
            const yoyLabel   = yoyPrev?.dateLabel  || yoyPrev?.label  || '';
            const hasData    = (row: RekapSheetRow) => row.values.some(v => v !== '' && v !== null);

            // ── AI reason cell renderer ──────────────────────────────────────
            const ReasonCell = ({
              ri, globalRi, row, side, baseReason, isSpecial, s,
              descVal, templateReason,
            }: {
              ri: number; globalRi: number; row: RekapSheetRow;
              side: 'mom' | 'yoy' | 'ytd'; baseReason: string; isSpecial: boolean;
              s: { bg: string; text: string; weight: string; border: string };
              descVal: string; templateReason: string;
            }) => {
              const key       = `${globalRi}-${side}`;
              const bothKey   = `${globalRi}-both`;
              const loading   = aiLoading[key] || aiLoading[bothKey];
              const aiText    = aiReasons[globalRi]?.[side];
              // Use key-existence check (not truthiness) so user can clear to empty string without reverting
              const hasOverride = side in (aiReasons[globalRi] ?? {});
              const aiError   = aiErrors[key];
              const gapVal    = side === 'mom' ? row.gapMoM : side === 'yoy' ? row.gapYoY : row.gapYtD;
              // template comes pre-computed from rekapTemplateReasons memo — no rebuild on every render
              const template  = isSpecial ? '' : templateReason;
              // hasOverride = user/AI has explicitly set a value (including empty string)
              const displayed = hasOverride ? (aiText ?? '') : template;
              const bgEven    = ri % 2 === 0 ? '#f0f3ff' : '#e8ecff';
              return (
                <td className="px-2 py-1"
                  style={{ backgroundColor: isSpecial ? s.bg : bgEven, color: isSpecial ? '#fff' : '#374151',
                    border: '1px solid #c7d2fe', minWidth: '300px', verticalAlign: 'top' }}>
                  {!isSpecial && (
                    <div className="flex flex-col gap-1">
                      {/* Text area — editable */}
                      <textarea
                        rows={displayed ? Math.min(14, displayed.split('\n').length + 2) : 3}
                        value={displayed || ''}
                        placeholder={loading ? 'Generating AI...' : ''}
                        onChange={e => setAiReasons(prev => ({
                          ...prev,
                          [globalRi]: { ...prev[globalRi], [side]: e.target.value },
                        }))}
                        className="w-full text-[10px] resize-y rounded border border-indigo-200 p-1.5 leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        style={{
                          backgroundColor: loading ? '#f5f3ff' : '#fff',
                          fontStyle: !hasOverride && !!template ? 'italic' : 'normal',
                          color: !hasOverride && !!template ? '#9ca3af' : '#374151',
                          fontFamily: 'inherit', minHeight: '72px',
                        }}
                      />
                      {/* AI buttons row */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          {loading ? (
                            <span className="text-[9px] text-purple-600 animate-pulse font-medium">Generating...</span>
                          ) : (
                            <>
                              <button
                                onClick={() => generateReason(globalRi, side, row, descVal)}
                                disabled={Math.abs(gapVal) === 0}
                                title={`Generate AI Reason ${side.toUpperCase()}`}
                                className="px-1.5 py-0.5 text-[9px] rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-30 whitespace-nowrap font-medium">
                                AI {side.toUpperCase()}
                              </button>
                              <button
                                onClick={() => openChat(globalRi, row, descVal)}
                                title="Buka chatbot AI — chat bebas untuk analisis akun ini"
                                className="px-1.5 py-0.5 text-[9px] rounded bg-sky-100 text-sky-700 hover:bg-sky-200 whitespace-nowrap font-medium">
                                Chat
                              </button>
                              {hasOverride && (
                                <button
                                  onClick={() => setAiReasons(prev => {
                                    const updated = { ...prev };
                                    if (updated[globalRi]) {
                                      const inner = { ...updated[globalRi] } as Record<string, string | undefined>;
                                      delete inner[side];
                                      updated[globalRi] = inner as { mom?: string; yoy?: string };
                                    }
                                    return updated;
                                  })}
                                  title="Hapus teks AI, kembalikan ke data sheet"
                                  className="px-1.5 py-0.5 text-[9px] rounded bg-red-50 text-red-500 hover:bg-red-100 whitespace-nowrap">
                                  ✕ reset
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        {aiError && (
                          <span className="text-[9px] text-red-500 leading-tight">{aiError}</span>
                        )}
                      </div>
                    </div>
                  )}
                </td>
              );
            };

            return (
              <div data-animate-card className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {/* Header bar */}
                <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2"
                  style={{ background: 'linear-gradient(to right,#1F3864,#2e4d8a)' }}>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      Rekap — {rekapSheetData.sheetName}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: '#c7d4f0' }}>
                      {rekapSheetData.rows.filter((r) => r.type === 'detail').length} akun detail
                      &ensp;·&ensp;{visibleAmountCols.length}{visibleAmtColIdxs !== null ? `/${amountCols.length}` : ''} kolom periode
                      &ensp;·&ensp;
                      <span style={{ color: '#fca5a5' }}>9 kolom analisis</span>
                      &ensp;(GAP MoM · MoM% · Reason MoM · GAP YoY · YoY% · Reason YoY · GAP YtD · YtD% · Reason YtD)
                    </p>
                  </div>
                  {/* Generate All AI Button */}
                  {aiBatch ? (
                    <div className="flex flex-col gap-1.5 min-w-[160px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-white/80 font-medium flex items-center gap-1">
                          <Loader2 size={11} className="animate-spin" />
                          {aiBatch.done}/{aiBatch.total} akun
                        </span>
                        <button
                          onClick={() => { aiCancelRef.current = true; setAiBatch(null); }}
                          className="text-[10px] px-2 py-0.5 rounded font-medium transition"
                          style={{ backgroundColor: 'rgba(239,68,68,0.75)', color: '#fff' }}>
                          Stop
                        </button>
                      </div>
                      <Progress
                        value={Math.round((aiBatch.done / aiBatch.total) * 100)}
                        className="h-1.5 bg-white/20"
                      />
                      <span className="text-[10px] text-white/60">
                        {Math.round((aiBatch.done / aiBatch.total) * 100)}%
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => generateAllSequential(rekapDisplayRows, descColIdx)}
                      className="px-3 py-1.5 text-xs rounded-lg font-medium whitespace-nowrap"
                      style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                      title="Generate AI analisis untuk semua baris detail — 1 per 4 detik (anti rate-limit)">
                      Generate All AI
                    </button>
                  )}
                </div>

                {/* ── Period selector bar ── */}
                {amountCols.length >= 2 && (() => {
                  const effMC = momSel?.curr ?? momCurrIdx;
                  const effMP = momSel?.prev ?? momPrevIdx;
                  const effYC = yoySel?.curr ?? yoyCurrIdx;
                  const effYP = yoySel?.prev ?? yoyPrevIdx;
                  // YtD defaults: last col of currYear vs last col of prevYear (from stored idxs)
                  const _ytdCI = rekapSheetData.ytdCurrColIdxs ?? [];
                  const _ytdPI = rekapSheetData.ytdPrevColIdxs ?? [];
                  const defaultYtdC = _ytdCI.length > 0
                    ? _ytdCI[_ytdCI.length - 1]
                    : momCurrIdx;
                  const defaultYtdP = _ytdPI.length > 0
                    ? _ytdPI[_ytdPI.length - 1]
                    : (yoyPrevIdx !== momCurrIdx ? yoyPrevIdx : 0);
                  const effYtdC = ytdSel?.curr ?? defaultYtdC;
                  const effYtdP = ytdSel?.prev ?? defaultYtdP;
                  const colLabel = (i: number) => {
                    const a = amountCols[i];
                    if (!a) return `Col ${i}`;
                    const tag = a.isCumulative ? ' [Up to]' : '';
                    return `${a.yearLabel ? a.yearLabel + ' ' : ''}${a.dateLabel}${tag}`.trim();
                  };
                  const sel = "text-[11px] rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400";
                  return (
                    <div className="px-4 py-2.5 border-b border-gray-200 bg-blue-50 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-blue-700">MoM</span>
                        <span className="text-[11px] text-gray-500">Periode ini:</span>
                        <select className={sel} value={effMC}
                          onChange={e => setMomSel(s => ({ curr: Number(e.target.value), prev: s?.prev ?? effMP }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                        <span className="text-[11px] text-gray-400">vs</span>
                        <select className={sel} value={effMP}
                          onChange={e => setMomSel(s => ({ curr: s?.curr ?? effMC, prev: Number(e.target.value) }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-green-700">YoY</span>
                        <span className="text-[11px] text-gray-500">Periode ini:</span>
                        <select className={sel} value={effYC}
                          onChange={e => setYoySel(s => ({ curr: Number(e.target.value), prev: s?.prev ?? effYP }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                        <span className="text-[11px] text-gray-400">vs</span>
                        <select className={sel} value={effYP}
                          onChange={e => setYoySel(s => ({ curr: s?.curr ?? effYC, prev: Number(e.target.value) }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-black" style={{ color: '#b38200' }}>YtD</span>
                        <span className="text-[11px] text-gray-500">Tahun ini s.d.:</span>
                        <select className={sel} value={effYtdC}
                          onChange={e => setYtdSel(s => ({ curr: Number(e.target.value), prev: s?.prev ?? effYtdP }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                        <span className="text-[11px] text-gray-400">vs</span>
                        <span className="text-[11px] text-gray-500">Tahun lalu s.d.:</span>
                        <select className={sel} value={effYtdP}
                          onChange={e => setYtdSel(s => ({ curr: s?.curr ?? effYtdC, prev: Number(e.target.value) }))}>
                          {amountCols.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                        </select>
                      </div>
                      {(momSel || yoySel || ytdSel) && (
                        <button onClick={() => { setMomSel(null); setYoySel(null); setYtdSel(null); }}
                          className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300">
                          Reset default
                        </button>
                      )}
                      {/* Column visibility picker */}
                      <div className="relative ml-auto">
                        <button
                          onClick={() => setShowColPicker(v => !v)}
                          className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border font-medium transition ${
                            visibleAmtColIdxs !== null
                              ? 'border-teal-500 bg-teal-50 text-teal-700'
                              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                          }`}>
                          <span>&#9776;</span>
                          Kolom{visibleAmtColIdxs !== null ? ` (${visibleAmtColIdxs.size}/${amountCols.length})` : ''}
                        </button>
                        {showColPicker && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setShowColPicker(false)} />
                            <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[200px] max-h-72 overflow-y-auto">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[11px] font-semibold text-gray-700">Tampilkan kolom periode</span>
                              <button
                                onClick={() => setVisibleAmtColIdxs(null)}
                                className="text-[10px] text-blue-600 hover:underline ml-2">
                                Semua
                              </button>
                            </div>
                            <div className="flex flex-col gap-1">
                              {amountCols.map((ac, i) => {
                                const checked = visibleAmtColIdxs === null ? !ac.isCumulative : visibleAmtColIdxs.has(i);
                                const label = `${ac.yearLabel ? ac.yearLabel + ' ' : ''}${ac.dateLabel || ac.label}${ac.isCumulative ? ' [Up to]' : ''}`.trim();
                                return (
                                  <label key={i} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        setVisibleAmtColIdxs(prev => {
                                          const current = prev === null
                                            ? new Set(amountCols.map((_, idx) => idx).filter(idx => !amountCols[idx].isCumulative))
                                            : new Set(prev);
                                          if (current.has(i)) {
                                            if (current.size <= 1) return prev; // keep at least 1
                                            current.delete(i);
                                          } else {
                                            current.add(i);
                                          }
                                          // revert to null if matches default (all non-cumulative selected)
                                          const defSet = new Set(amountCols.map((_, idx) => idx).filter(idx => !amountCols[idx].isCumulative));
                                          const isDefault = current.size === defSet.size && [...current].every(ci => defSet.has(ci));
                                          return isDefault ? null : current;
                                        });
                                      }}
                                      className="rounded"
                                    />
                                    <span className={`text-[11px] ${ac.isCumulative ? 'text-amber-700 italic' : 'text-gray-700'}`}>{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {rekapTotalPages > 1 && (
                  <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span><span className="font-semibold text-gray-800">{rekapDisplayRowsLive.length}</span> baris</span>
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
                      {/* ── Row 1: year group labels ── */}
                      <tr>
                        <th className="px-3 py-1 text-white text-[10px] font-bold"
                          style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}></th>
                        {descColIdxList.map(ci => (
                          <th key={ci} className="px-3 py-1 text-white text-[10px] font-bold italic"
                            style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>
                            Description
                          </th>
                        ))}
                        {visibleAmountCols.map((ac) => (
                          <th key={ac.colIdx} className="px-3 py-1 text-white text-[10px] font-bold text-center whitespace-nowrap"
                            style={{ backgroundColor: amtColBg(ac), border: '1px solid rgba(255,255,255,0.2)' }}>
                            {ac.yearLabel}
                          </th>
                        ))}
                        {/* Dynamic YtD value columns — group row */}
                        {hasYtdData && (
                          <>
                            <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                              style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>
                              {effYtdCAC?.yearLabel || 'YtD'}
                            </th>
                            <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                              style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>
                              {effYtdPAC?.yearLabel || 'YtD'}
                            </th>
                          </>
                        )}
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM</th>
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM</th>
                        <th className="px-3 py-1 text-white text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>Reason MoM</th>
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY</th>
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY</th>
                        <th className="px-3 py-1 text-white text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>Reason YoY</th>
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YtD</th>
                        <th className="px-3 py-1 text-black text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YtD</th>
                        <th className="px-3 py-1 text-white text-[10px] font-bold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#1F3864', border: '1px solid rgba(255,255,255,0.15)' }}>Reason YtD</th>
                      </tr>
                      {/* ── Row 2: date labels ── */}
                      <tr>
                        <th className="px-3 py-1.5 text-white text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#244185', border: '1px solid rgba(255,255,255,0.15)' }}>Account</th>
                        {descColIdxList.map(ci => (
                          <th key={ci} className="px-3 py-1.5 text-white text-[10px] font-semibold italic text-center"
                            style={{ backgroundColor: '#244185', border: '1px solid rgba(255,255,255,0.15)', minWidth: '180px' }}>
                            {rekapSheetData.originalHeaders?.[ci] || rekapSheetData.headers[ci]}
                          </th>
                        ))}
                        {visibleAmountCols.map((ac) => (
                          <th key={ac.colIdx} className="px-3 py-1.5 text-white text-[10px] font-semibold text-center whitespace-nowrap"
                            style={{ backgroundColor: ac.isCumulative ? '#E36C09' : '#244185', border: '1px solid rgba(255,255,255,0.2)', minWidth: '90px' }}>
                            {ac.dateLabel || ac.label}
                          </th>
                        ))}
                        {/* Dynamic YtD value column headers */}
                        {hasYtdData && (
                          <>
                            <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                              style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00', minWidth: '100px' }}>
                              YtD {ytdCLabel}
                            </th>
                            <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                              style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00', minWidth: '100px' }}>
                              YtD {ytdPLabel}
                            </th>
                          </>
                        )}
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>GAP<br/>MoM</th>
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>MoM<br/>%</th>
                        <th className="px-3 py-1.5 text-white text-[10px] font-semibold text-center"
                          style={{ backgroundColor: '#244185', border: '1px solid rgba(255,255,255,0.15)', minWidth: '300px' }}>
                          vs {prevLabel}
                        </th>
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>GAP<br/>YoY</th>
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>YoY<br/>%</th>
                        <th className="px-3 py-1.5 text-white text-[10px] font-semibold text-center"
                          style={{ backgroundColor: '#244185', border: '1px solid rgba(255,255,255,0.15)', minWidth: '300px' }}>
                          vs {yoyLabel}
                        </th>
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center whitespace-nowrap"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00' }}>GAP<br/>YtD</th>
                        <th className="px-3 py-1.5 text-black text-[10px] font-semibold text-center"
                          style={{ backgroundColor: '#FFC000', border: '1px solid #cc9a00', minWidth: '120px' }}>
                          {hasYtdData && ytdCLabel && ytdPLabel
                            ? `${ytdCLabel} vs ${ytdPLabel}`
                            : (rekapSheetData.ytdLabel || 'YtD %')}
                        </th>
                        <th className="px-3 py-1.5 text-white text-[10px] font-semibold text-center"
                          style={{ backgroundColor: '#244185', border: '1px solid rgba(255,255,255,0.15)', minWidth: '300px' }}>
                          vs {ytdPLabel || ytdCLabel || 'YtD'}
                        </th>
                      </tr>
                    </thead>
                    <tbody ref={rekapBodyRef as React.Ref<HTMLTableSectionElement>}>
                      {rekapPageRows.map((row, ri) => {
                        const globalRi  = rekapPage * REKAP_PAGE_SIZE + ri;
                        const s         = rekapRowStyle(row.type, globalRi);
                        const acctVal    = String(row.values[accountColIdx] ?? '');
                        const descVal    = descColIdx >= 0 ? String(row.values[descColIdx] ?? '') : '';
                        const isCategory = row.type === 'category';
                        // Subtotal with an account code (e.g. 71400000) → treated like a detail label, no MoM/YoY
                        const isAccountSubtotal = row.type === 'subtotal' && /^\d{5,}$/.test(acctVal);
                        // Subtotal without account code → section total, show MoM/YoY but no Reason
                        const isSectionTotal = row.type === 'subtotal' && !(/^\d{5,}$/.test(acctVal));
                        // Whether to hide MoM/YoY entirely (category rows and account-based subtotals)
                        const hideMomYoy = isCategory || isAccountSubtotal;
                        // Whether to hide Reason column (all non-detail rows)
                        const hideReason = isCategory || isAccountSubtotal || isSectionTotal;
                        const isSpecial  = row.type === 'category' || row.type === 'subtotal';
                        const gapColor  = (v: number) =>
                          isSpecial ? '#fff' : v < 0 ? '#b91c1c' : v > 0 ? '#15803d' : '#374151';
                        const rowHasData = hasData(row);
                        return (
                          <tr key={ri} className="js-rekap-row">
                            {/* Account */}
                            <td className="px-3 py-1.5 whitespace-nowrap font-mono text-[10px]"
                              style={{ backgroundColor: s.bg, color: s.text, fontWeight: s.weight, border: `1px solid ${s.border}`, minWidth: '80px' }}>
                              {acctVal}
                            </td>
                            {/* Description columns */}
                            {descColIdxList.map(ci => (
                              <td key={ci} className="px-3 py-1.5"
                                style={{ backgroundColor: s.bg, color: s.text, fontWeight: s.weight, border: `1px solid ${s.border}`, minWidth: '180px' }}>
                                {String(row.values[ci] ?? '')}
                              </td>
                            ))}
                            {/* All amount columns */}
                            {visibleAmountCols.map((ac) => {
                              const v = row.values[ac.colIdx];
                              const acBg = isSpecial ? s.bg : ri % 2 === 0
                                ? (ac.isCumulative ? '#fff8ec' : '#f9fafb')
                                : (ac.isCumulative ? '#fff3d6' : '#f0f4ff');
                              return (
                                <td key={ac.colIdx} className="px-3 py-1.5 whitespace-nowrap text-right"
                                  style={{ backgroundColor: acBg, color: s.text, fontWeight: s.weight,
                                    border: `1px solid ${isSpecial ? s.border : ac.isCumulative ? '#f5c97a' : '#e5e7eb'}`,
                                    minWidth: '90px' }}>
                                  {v !== '' && v !== null && v !== undefined
                                    ? fmtRp(parseNum(v)) : ''}
                                </td>
                              );
                            })}
                            {/* Dynamic YtD value columns (shown when YtD data available) */}
                            {hasYtdData && (
                              <>
                                <td className="px-3 py-1.5 whitespace-nowrap text-right"
                                  style={{ backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                    color: s.text, fontWeight: s.weight, border: `1px solid ${isSpecial ? s.border : '#fde68a'}`,
                                    minWidth: '100px' }}>
                                  {rowHasData && row.ytdCurrV !== 0 ? fmtRp(row.ytdCurrV) : ''}
                                </td>
                                <td className="px-3 py-1.5 whitespace-nowrap text-right"
                                  style={{ backgroundColor: isSpecial ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                    color: s.text, fontWeight: s.weight, border: `1px solid ${isSpecial ? s.border : '#fde68a'}`,
                                    minWidth: '100px' }}>
                                  {rowHasData && row.ytdPrevV !== 0 ? fmtRp(row.ytdPrevV) : ''}
                                </td>
                              </>
                            )}
                            {/* GAP MoM */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.gapMoM), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData ? fmtRp(row.gapMoM) : ''}
                            </td>
                            {/* MoM % */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.pctMoM), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData ? fmtPct(row.pctMoM) : ''}
                            </td>
                            {/* Reason MoM */}
                            {ReasonCell({ ri, globalRi, row, side: 'mom',
                              baseReason: row.reasonMoM, isSpecial: hideReason, s, descVal,
                              templateReason: rekapTemplateReasons.get(globalRi)?.mom ?? '' })}
                            {/* GAP YoY */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.gapYoY), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData ? fmtRp(row.gapYoY) : ''}
                            </td>
                            {/* YoY % */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.pctYoY), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData ? fmtPct(row.pctYoY) : ''}
                            </td>
                            {/* Reason YoY */}
                            {ReasonCell({ ri, globalRi, row, side: 'yoy',
                              baseReason: row.reasonYoY, isSpecial: hideReason, s, descVal,
                              templateReason: rekapTemplateReasons.get(globalRi)?.yoy ?? '' })}
                            {/* GAP YtD */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.gapYtD), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData && hasYtdData ? fmtRp(row.gapYtD) : ''}
                            </td>
                            {/* YtD % */}
                            <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium"
                              style={{ backgroundColor: hideMomYoy || isSectionTotal ? s.bg : ri % 2 === 0 ? '#fffbeb' : '#fef9e0',
                                color: gapColor(row.pctYtD), fontWeight: s.weight, border: `1px solid ${isSectionTotal ? s.border : '#fde68a'}` }}>
                              {!hideMomYoy && rowHasData && hasYtdData ? fmtPct(row.pctYtD) : ''}
                            </td>
                            {/* Reason YtD */}
                            {ReasonCell({ ri, globalRi, row, side: 'ytd',
                              baseReason: row.reasonYtD ?? '', isSpecial: hideReason || !hasYtdData, s, descVal,
                              templateReason: rekapTemplateReasons.get(globalRi)?.ytd ?? '' })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {/* ── AI Chat Modal ─────────────────────────────────────────────── */}
      {chat?.open && (
        <div ref={chatBackdropRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setChat(p => p ? { ...p, open: false } : p); }}>
          <div ref={chatModalRef} className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: '700px', height: '82vh', maxWidth: '96vw' }}>
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0"
              style={{ background: 'linear-gradient(to right,#1F3864,#2e4d8a)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold text-sm truncate">Chat AI — {chat.accountCode} {chat.accountName}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#c7d4f0' }}>Chat bebas · data akun sudah dimuat sebagai konteks</div>
              </div>
              <select
                value={chat.model}
                onChange={e => {
                  const found = OPENROUTER_MODELS.find(m => m.id === e.target.value);
                  setChat(p => p ? { ...p, model: e.target.value, keyIdx: found?.keyIdx ?? 0 } : p);
                }}
                className="text-[11px] rounded border border-white/30 bg-white/10 text-white px-2 py-1 focus:outline-none focus:bg-white/20"
                style={{ maxWidth: '185px' }}>
                {OPENROUTER_MODELS.map(m => (
                  <option key={m.id} value={m.id} className="text-gray-800 bg-white">{m.label}</option>
                ))}
              </select>
              <button onClick={() => setChat(p => p ? { ...p, open: false } : p)}
                className="text-white/70 hover:text-white text-xl leading-none px-1 flex-shrink-0">✕</button>
            </div>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chat.messages.length === 0 && !chat.loading && (
                <div className="text-center text-gray-400 text-xs mt-10">
                  <div className="font-medium text-sm">Tanyakan apa saja tentang akun <span className="text-indigo-600 font-semibold">{chat.accountCode}</span></div>
                  <div className="mt-1 text-[10px]">AI sudah mengetahui histori nilai, breakdown klasifikasi, dan tren akun ini.</div>
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {['Jelaskan tren historis akun ini', 'Apa klasifikasi dengan nilai terbesar?', 'Buat narasi analisis MoM', 'Buat narasi analisis YoY'].map(hint => (
                      <button key={hint} onClick={() => setChat(p => p ? { ...p, input: hint } : p)}
                        className="px-3 py-1 text-[10px] rounded-full border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition">
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chat.messages.map((msg, mi) => (
                <div key={mi} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: '#1F3864', color: '#fff' }}>AI</div>
                  )}
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}>
                    {msg.content}
                    {msg.role === 'assistant' && (
                      <div className="flex gap-1 mt-2 pt-2 border-t border-gray-200 flex-wrap">
                        <button onClick={() => setAiReasons(prev => ({ ...prev, [chat.globalRi]: { ...prev[chat.globalRi], mom: msg.content } }))}
                          className="px-2 py-0.5 text-[9px] rounded bg-purple-100 text-purple-700 hover:bg-purple-200 font-medium">
                          → Reason MoM
                        </button>
                        <button onClick={() => setAiReasons(prev => ({ ...prev, [chat.globalRi]: { ...prev[chat.globalRi], yoy: msg.content } }))}
                          className="px-2 py-0.5 text-[9px] rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-medium">
                          → Reason YoY
                        </button>
                        <button onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="px-2 py-0.5 text-[9px] rounded bg-gray-200 text-gray-600 hover:bg-gray-300">
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-blue-600 text-white">U</div>
                  )}
                </div>
              ))}
              {chat.loading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: '#1F3864', color: '#fff' }}>AI</div>
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5">
                    <div className="flex gap-1 items-center">
                      <span className="animate-bounce text-gray-400 text-base" style={{ animationDelay: '0ms' }}>●</span>
                      <span className="animate-bounce text-gray-400 text-base" style={{ animationDelay: '160ms' }}>●</span>
                      <span className="animate-bounce text-gray-400 text-base" style={{ animationDelay: '320ms' }}>●</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Input */}
            <div className="px-4 py-3 border-t flex-shrink-0 bg-gray-50 rounded-b-xl">
              <div className="flex gap-2 items-end">
                <textarea
                  rows={2}
                  value={chat.input}
                  onChange={e => setChat(p => p ? { ...p, input: e.target.value } : p)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                  placeholder="Ketik pertanyaan atau instruksi... (Enter = kirim · Shift+Enter = baris baru)"
                  className="flex-1 text-sm rounded-lg border border-gray-300 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ minHeight: '56px', fontFamily: 'inherit' }}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={chat.loading || !chat.input.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition"
                  style={{ backgroundColor: '#1F3864', color: '#fff', minHeight: '56px' }}>
                  Kirim
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Model: <strong>{OPENROUTER_MODELS.find(m => m.id === chat.model)?.label ?? chat.model}</strong>
                &ensp;·&ensp;Klik "→ Reason MoM/YoY" pada respons AI untuk menyalin ke tabel
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Keyword Modal ─────────────────────────────────────────────────── */}
      {showKeywordModal && (
        <div ref={modalBackdropRef} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div ref={modalRef} className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">
                {editingKeyword ? 'Edit Keyword' : 'Tambah Keyword Baru'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Keyword akan digunakan untuk matching otomatis saat upload file
              </p>
              
              {/* Input Mode Toggle */}
              {!editingKeyword && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => setInputMode('simple')}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                      inputMode === 'simple'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Input Cepat
                  </button>
                  <button
                    onClick={() => setInputMode('advanced')}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                      inputMode === 'advanced'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    Input Detail
                  </button>
                </div>
              )}
            </div>
            
            <div ref={modalFormBodyRef} className="p-6 space-y-5">
              {/* Simple Natural Language Input */}
              {inputMode === 'simple' && !editingKeyword && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Tulis Natural Language <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={naturalInput}
                    onChange={(e) => setNaturalInput(e.target.value)}
                    placeholder={'Contoh teks biasa:\nJika ada text "Sindikasi SLL" maka klasifikasi berisi "Sindikasi SLL"\n\nContoh NOT (negatif):\nJika tidak ada kata "K3" atau "SLA" maka klasifikasi berisi "Denda Keterlambatan"\n\nContoh regex (pola tetap):\nJika teks cocok pola "RoU \\d+" maka klasifikasi berisi "RoU Aset"\n\nContoh regex (ekstrak otomatis):\nBy kolom Text, diambil dari kata "RoU" dan nomor aset\n  → hasil otomatis diambil dari Excel, misal: RoU 380000000077\n\nContoh nomor dokumen:\nJika nomor dokumen diawali 18 maka klasifikasi berisi "Tag. Klaim Asuransi"\n\nContoh kolom bebas:\nJika kolom Cost Center diawali 0001 maka klasifikasi berisi "Biaya"\n\nTambah remark / priority 5 sesuai kebutuhan'}
                    rows={4}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition font-mono text-sm"
                  />
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700 font-semibold mb-1">Tip Format:</p>
                    <ul className="text-xs text-blue-600 space-y-0.5">
                      <li>• Teks: jika ada text &quot;X&quot; maka klasifikasi berisi &quot;Y&quot;</li>
                      <li>• NOT: jika tidak ada kata &quot;K3&quot; atau &quot;SLA&quot; maka berisi &quot;Y&quot;</li>
                      <li>• Regex pola: jika teks cocok pola &quot;RoU \d+&quot; maka berisi &quot;RoU Aset&quot;</li>
                      <li>• Ekstrak otomatis: diambil dari kata &quot;RoU&quot; dan nomor aset → hasil dari Excel</li>
                      <li>• Nomor dok: jika nomor dokumen diawali 18 maka berisi &quot;Y&quot;</li>
                      <li>• Kolom bebas: jika kolom Account diawali 18 maka berisi &quot;Y&quot;</li>
                      <li>• Tambah: remark / priority 10</li>
                      <li>• Akun tertentu: ... di akun 62301 / di akun &apos;62301,62401&apos;</li>
                      <li>• Kolom sumber: by kolom &quot;Document Header Text&quot;, text &quot;SLL&quot; berisi &quot;Sindikasi SLL&quot;</li>
                    </ul>
                  </div>
                  
                  {/* Preview parsed result */}
                  {naturalInput && (() => {
                    const parsed = parsedNaturalInput;
                    if (parsed) {
                      const isDuplicate = checkDuplicateKeyword(parsed.keyword, parsed.type, parsed.accountCodes ?? '');
                      if (isDuplicate) {
                        return (
                          <div className="mt-3 p-3 bg-red-50 border border-red-300 rounded-lg">
                            <p className="text-xs font-semibold text-red-800 mb-2">⚠️ Keyword Sudah Ada:</p>
                            <div className="space-y-1 text-xs text-red-700">
                              <div><span className="font-semibold">Keyword:</span> {parsed.keyword}</div>
                              <div><span className="font-semibold">Type:</span> {parsed.type}</div>
                              <div className="mt-2 pt-2 border-t border-red-200">
                                <p className="font-semibold">Keyword "{parsed.keyword}" dengan type "{parsed.type}" sudah terdaftar. Silakan gunakan keyword yang berbeda.</p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      const isRegexKw = parsed.keyword.toLowerCase().startsWith('regex:');
                      const isExtractKw = isRegexKw && !parsed.result;
                      return (
                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-xs font-semibold text-green-800 mb-2">Terdeteksi:</p>
                          <div className="space-y-1 text-xs text-green-700">
                            <div><span className="font-semibold">Keyword:</span> <code className="bg-green-100 px-1 rounded">{parsed.keyword}</code></div>
                            <div><span className="font-semibold">Type:</span> {parsed.type}</div>
                            <div>
                              <span className="font-semibold">Result:</span>{' '}
                              {isExtractKw
                                ? <span className="italic text-green-600">&#123;match&#125; — otomatis diambil dari teks Excel yang cocok</span>
                                : parsed.result || <span className="italic text-green-500">kosong</span>
                              }
                            </div>
                            <div><span className="font-semibold">Priority:</span> {parsed.priority}</div>
                            {parsed.accountCodes && (
                              <div><span className="font-semibold">Berlaku di Akun:</span> <code className="bg-green-100 px-1 rounded">{parsed.accountCodes}</code></div>
                            )}
                            {parsed.sourceColumn && (
                              <div><span className="font-semibold">Cek di Kolom:</span> <code className="bg-amber-100 px-1 rounded">{parsed.sourceColumn}</code></div>
                            )}
                            {isExtractKw && (
                              <div className="mt-1.5 pt-1.5 border-t border-green-200 text-green-600">
                                Contoh: jika teks Excel berisi &quot;RoU 380000000077&quot;, maka Klasifikasi = &quot;RoU 380000000077&quot;
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } else {
                      return (
                        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-xs text-yellow-700">Format belum terdeteksi. Gunakan contoh format di atas.</p>
                        </div>
                      );
                    }
                  })()}
                </div>
              )}
              
              {/* Advanced Manual Input */}
              {(inputMode === 'advanced' || editingKeyword) && (
                <>
                  {/* ── Mode Selector ─────────────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Mode Matching</label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { value: 'normal', label: 'Teks Biasa',   ring: 'ring-gray-400',   active: 'bg-gray-700 text-white border-gray-700',   inactive: 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50' },
                        { value: 'regex',  label: 'Regex/Pola',   ring: 'ring-indigo-400', active: 'bg-indigo-600 text-white border-indigo-600', inactive: 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50' },
                        { value: 'not',    label: 'NOT (negatif)',ring: 'ring-orange-400', active: 'bg-orange-500 text-white border-orange-500', inactive: 'bg-white text-orange-600 border-orange-300 hover:bg-orange-50' },
                        { value: 'docno',  label: 'Nomor Dok.',   ring: 'ring-green-400',  active: 'bg-green-600 text-white border-green-600',  inactive: 'bg-white text-green-700 border-green-300 hover:bg-green-50' },
                        { value: 'col',    label: 'Kolom Excel',  ring: 'ring-teal-400',   active: 'bg-teal-600 text-white border-teal-600',   inactive: 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50' },
                      ] as const).map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            // Compute current raw value (strip existing prefix)
                            const cur = keywordForm.keyword;
                            const rawPart = cur.toLowerCase().startsWith('regex:') ? cur.slice(6).trim()
                              : cur.toLowerCase().startsWith('not:')   ? cur.slice(4).trim()
                              : cur.toLowerCase().startsWith('docno:') ? cur.slice(6).trim()
                              : cur.toLowerCase().startsWith('col:')   ? ''
                              : cur;
                            setKwMode(m.value);
                            if (m.value === 'col') {
                              // Keep existing col parts if already col mode, else reset
                              if (!cur.toLowerCase().startsWith('col:')) { setColHeader(''); setColPattern(''); }
                              setKeywordForm({ ...keywordForm, keyword: `col:${colHeader}:${colPattern}` });
                            } else {
                              const prefix: Record<string, string> = { normal: '', regex: 'regex:', not: 'not:', docno: 'docno:' };
                              setKeywordForm({ ...keywordForm, keyword: (prefix[m.value] || '') + rawPart });
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            kwMode === m.value ? `${m.active} ring-2 ${m.ring} ring-offset-1` : m.inactive
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Keyword / Column Input ────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      {kwMode === 'col'    ? 'Kolom & Nilai'
                       : kwMode === 'docno' ? 'Pola Nomor Dokumen'
                       : kwMode === 'not'   ? 'Kata yang TIDAK boleh ada'
                       : kwMode === 'regex' ? 'Pola Regex'
                       : 'Keyword'} <span className="text-red-500">*</span>
                    </label>

                    {kwMode === 'col' ? (
                      // ── Col mode: dropdown + pattern input
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] text-teal-600 font-semibold uppercase tracking-wide mb-1 block">Nama Kolom Excel</label>
                            <select
                              value={colHeader}
                              onChange={(e) => {
                                setColHeader(e.target.value);
                                setKeywordForm({ ...keywordForm, keyword: `col:${e.target.value}:${colPattern}` });
                              }}
                              className="w-full px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm bg-teal-50"
                            >
                              <option value="">-- Pilih kolom --</option>
                              {availableColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-teal-600 font-semibold uppercase tracking-wide mb-1 block">Pola Nilai</label>
                            <input
                              type="text"
                              value={colPattern}
                              onChange={(e) => {
                                setColPattern(e.target.value);
                                setKeywordForm({ ...keywordForm, keyword: `col:${colHeader}:${e.target.value}` });
                              }}
                              placeholder="18*  /  *0001*  /  0001"
                              className="w-full px-3 py-2 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono bg-teal-50"
                            />
                          </div>
                        </div>
                        <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-lg">
                          <p className="text-xs text-teal-600 font-mono font-semibold mb-1">
                            Preview: <span className="text-teal-800">{keywordForm.keyword || 'col:...:...'}</span>
                          </p>
                          <ul className="text-xs text-teal-600 space-y-0.5">
                            <li>• <code>18*</code> = diawali &quot;18&quot; &nbsp;|&nbsp; <code>*18*</code> = mengandung &quot;18&quot; &nbsp;|&nbsp; <code>18</code> = mengandung &quot;18&quot;</li>
                            <li>• <code>regex:^18\d+</code> = gunakan pola regex pada nilai kolom</li>
                            {!sheetDataList.length && <li className="text-teal-500 italic">• Upload file Excel agar daftar kolom terisi otomatis dari header file</li>}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      // ── Other modes: single text input
                      <>
                        <div className="relative">
                          {kwMode !== 'normal' && (
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-mono pointer-events-none select-none">
                              {kwMode === 'regex' ? 'regex:' : kwMode === 'not' ? 'not:' : 'docno:'}
                            </span>
                          )}
                          <input
                            type="text"
                            value={
                              kwMode === 'normal' ? keywordForm.keyword
                              : kwMode === 'regex' ? (keywordForm.keyword.toLowerCase().startsWith('regex:') ? keywordForm.keyword.slice(6) : keywordForm.keyword)
                              : kwMode === 'not'   ? (keywordForm.keyword.toLowerCase().startsWith('not:')   ? keywordForm.keyword.slice(4) : keywordForm.keyword)
                              : kwMode === 'docno' ? (keywordForm.keyword.toLowerCase().startsWith('docno:') ? keywordForm.keyword.slice(6) : keywordForm.keyword)
                              : keywordForm.keyword
                            }
                            onChange={(e) => {
                              const prefix: Record<string, string> = { normal: '', regex: 'regex:', not: 'not:', docno: 'docno:' };
                              setKeywordForm({ ...keywordForm, keyword: (prefix[kwMode] || '') + e.target.value });
                            }}
                            placeholder={
                              kwMode === 'normal' ? 'Contoh: Sindikasi SLL, Beban Bunga'
                              : kwMode === 'regex' ? 'Contoh: RoU \d+  atau  ^Bunga\s+(\w+)'
                              : kwMode === 'not'   ? 'Contoh: K3,SLA  atau  K3|SLA'
                              : 'Contoh: 18  (diawali 18)  atau  100005'
                            }
                            className={`w-full py-2.5 border rounded-lg focus:ring-2 transition font-mono text-sm ${
                              kwMode !== 'normal' ? 'pl-[4.5rem] pr-4' : 'px-4'
                            } ${
                              keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, keywordForm.accountCodes, editingKeyword?.id)
                                ? 'border-red-300 focus:ring-red-500 focus:border-red-500 bg-red-50'
                                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                            }`}
                          />
                        </div>
                        {keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, keywordForm.accountCodes, editingKeyword?.id) && (
                          <p className="text-xs text-red-600 mt-1.5 font-medium">Keyword ini sudah ada untuk type {keywordForm.type} dan akun yang sama</p>
                        )}
                        {kwMode === 'regex' && (
                          <div className="mt-2 p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                            <p className="text-xs text-indigo-700 font-semibold mb-1">Regex — cocok terhadap kolom teks (Header Text)</p>
                            <ul className="text-xs text-indigo-600 space-y-0.5">
                              <li>• <code>\d+</code> = satu atau lebih angka &nbsp;|&nbsp; <code>\d&#123;8&#125;</code> = tepat 8 angka</li>
                              <li>• <code>(RoU \d+)</code> = capture group → gunakan <code>&#123;1&#125;</code> di Result</li>
                              <li>• Kosongkan Result → otomatis pakai teks yang cocok</li>
                            </ul>
                          </div>
                        )}
                        {kwMode === 'not' && (
                          <div className="mt-2 p-2.5 bg-orange-50 border border-orange-200 rounded-lg">
                            <p className="text-xs text-orange-700 font-semibold mb-1">NOT — aktif jika kolom teks TIDAK mengandung kata berikut</p>
                            <ul className="text-xs text-orange-600 space-y-0.5">
                              <li>• <code>K3</code> → tidak ada &quot;K3&quot; &nbsp;|&nbsp; <code>K3,SLA</code> → tidak ada &quot;K3&quot; DAN tidak ada &quot;SLA&quot;</li>
                              <li>• Gunakan koma (,) atau pipe (|) sebagai pemisah</li>
                              <li>• Dicek setelah semua keyword positif tidak cocok</li>
                            </ul>
                          </div>
                        )}
                        {kwMode === 'docno' && (
                          <div className="mt-2 p-2.5 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-xs text-green-700 font-semibold mb-1">Nomor Dokumen — cocok terhadap kolom Belegnummer / Doc. No.</p>
                            <ul className="text-xs text-green-600 space-y-0.5">
                              <li>• <code>18</code> → nomor dokumen <strong>diawali</strong> &quot;18&quot; (misal 1800001234)</li>
                              <li>• <code>regex:^18\d+</code> → gunakan pola regex terhadap nomor dokumen</li>
                            </ul>
                          </div>
                        )}
                        {kwMode === 'normal' && !keywordForm.keyword && (
                          <p className="text-xs text-gray-500 mt-1.5">Cocok jika kolom teks <strong>mengandung</strong> keyword ini (case insensitive)</p>
                        )}
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={keywordForm.type}
                      onChange={(e) => setKeywordForm({ ...keywordForm, type: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    >
                      <option value="klasifikasi">Klasifikasi</option>
                      <option value="remark">Remark</option>
                    </select>
                    {keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, keywordForm.accountCodes, editingKeyword?.id) && (
                      <p className="text-xs text-red-600 mt-1.5 font-medium">
                        Kombinasi keyword "{keywordForm.keyword}" dengan type "{keywordForm.type}" untuk akun yang sama sudah ada
                      </p>
                    )}
                    {(!keywordForm.keyword || !checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, keywordForm.accountCodes, editingKeyword?.id)) && (
                      <p className="text-xs text-gray-500 mt-1.5">
                        {keywordForm.type === 'klasifikasi' 
                          ? 'Digunakan untuk kolom klasifikasi (header text / description)'
                          : 'Digunakan untuk kolom remark (assignment / reference)'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Result/Output
                      {!keywordForm.keyword.toLowerCase().startsWith('regex:') && !keywordForm.keyword.toLowerCase().startsWith('col:') && !keywordForm.keyword.toLowerCase().startsWith('docno:') && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      type="text"
                      value={keywordForm.result}
                      onChange={(e) => setKeywordForm({ ...keywordForm, result: e.target.value })}
                      placeholder={
                        keywordForm.keyword.toLowerCase().startsWith('regex:') ? '{match} atau teks tetap'
                        : keywordForm.keyword.toLowerCase().startsWith('col:') ? 'Teks tetap, atau kosongkan → ambil nilai kolom'
                        : 'Contoh: Sindikasi SLL, Beban Bunga'
                      }
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition font-mono text-sm"
                    />
                    {keywordForm.keyword.toLowerCase().startsWith('regex:') ? (
                      <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                        <p>Kosongkan atau tulis <code className="bg-gray-100 px-1 rounded">{'{match}'}</code> → hasil = teks yang ter-extract dari Excel</p>
                        <p>Atau tulis teks tetap, misal: <code className="bg-gray-100 px-1 rounded">RoU Aset</code></p>
                        <p>Dengan capture group: <code className="bg-gray-100 px-1 rounded">{'RoU {1}'}</code> → gunakan hasil grup pertama</p>
                      </div>
                    ) : keywordForm.keyword.toLowerCase().startsWith('col:') ? (
                      <p className="text-xs text-gray-500 mt-1.5">Kosongkan → hasil otomatis diambil dari nilai kolom tersebut. Atau isi teks tetap misal: <code className="bg-gray-100 px-1 rounded">Tag. Klaim Asuransi</code></p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-1.5">Hasil yang akan ditampilkan jika keyword ditemukan</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Priority
                    </label>
                    <input
                      type="number"
                      value={keywordForm.priority}
                      onChange={(e) => setKeywordForm({ ...keywordForm, priority: parseInt(e.target.value) || 0 })}
                      placeholder="0-100"
                      min="0"
                      max="100"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                    <p className="text-xs text-gray-500 mt-1.5">
                      Priority lebih tinggi akan diutamakan (0-100). Default: 0
                    </p>
                  </div>

                  {/* Source Column */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Cek di Kolom
                      <span className="ml-2 text-xs font-normal text-gray-500">(kosong = kolom deskripsi/header teks)</span>
                    </label>
                    <select
                      value={keywordForm.sourceColumn}
                      onChange={(e) => setKeywordForm({ ...keywordForm, sourceColumn: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition bg-white text-sm"
                    >
                      <option value="">— Otomatis (kolom deskripsi default) —</option>
                      {availableColumns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1.5">
                      Pilih kolom yang akan dicocokkan dengan keyword ini. Misal: kolom "Assignment" atau "Text".
                    </p>
                  </div>

                  {/* Account Code Scope */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Berlaku di Akun
                      <span className="ml-2 text-xs font-normal text-gray-500">(kosong = berlaku untuk semua akun)</span>
                    </label>
                    {availableAccountCodes.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Upload file Excel terlebih dahulu untuk melihat daftar akun</p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto bg-gray-50 flex flex-wrap gap-1.5">
                        {availableAccountCodes.map(code => {
                          const selected = (keywordForm.accountCodes ?? '').split(',').map(c => c.trim()).filter(Boolean).includes(code);
                          return (
                            <button key={code} type="button"
                              onClick={() => {
                                const current = (keywordForm.accountCodes ?? '').split(',').map(c => c.trim()).filter(Boolean);
                                const next = selected ? current.filter(c => c !== code) : [...current, code];
                                setKeywordForm({ ...keywordForm, accountCodes: next.join(',') });
                              }}
                              className={`px-2 py-1 rounded text-[11px] font-mono border transition ${
                                selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-blue-50 hover:border-blue-300'
                              }`}
                            >{code}</button>
                          );
                        })}
                      </div>
                    )}
                    {keywordForm.accountCodes && (
                      <button type="button" onClick={() => setKeywordForm({ ...keywordForm, accountCodes: '' })}
                        className="mt-1.5 text-xs text-gray-400 hover:text-red-500 transition">
                        Hapus semua pilihan (berlaku ke semua akun)
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => {
                  setShowKeywordModal(false);
                  setEditingKeyword(null);
                  setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0, accountCodes: '', sourceColumn: '' });
                  setNaturalInput('');
                  setInputMode('simple');
                  setKwMode('normal');
                  setColHeader('');
                  setColPattern('');
                }}
                className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  // If simple mode, parse natural input first
                  if (inputMode === 'simple' && !editingKeyword) {
                    const parsed = parseNaturalKeyword(naturalInput);
                    if (parsed) {
                      handleSaveKeyword(parsed);
                    }
                  } else {
                    handleSaveKeyword();
                  }
                }}
                disabled={(() => {
                  if (inputMode === 'simple' && !editingKeyword) {
                    // Simple mode validation
                    const parsed = parsedNaturalInput;
                    if (!parsed) return true;
                    return checkDuplicateKeyword(parsed.keyword, parsed.type, parsed.accountCodes ?? '');
                  } else {
                    // Advanced mode validation
                    if (!keywordForm.keyword) return true;
                    // col mode: need colHeader to be set
                    if (kwMode === 'col' && !colHeader) return true;
                    // Regex, NOT, col modes: result is optional
                    const isSpecialMode = keywordForm.keyword.toLowerCase().startsWith('regex:') || keywordForm.keyword.toLowerCase().startsWith('not:') || keywordForm.keyword.toLowerCase().startsWith('col:');
                    if (!isSpecialMode && !keywordForm.result) return true;
                    return checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, keywordForm.accountCodes, editingKeyword?.id);
                  }
                })()}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingKeyword ? 'Update' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-[60]">
          <div className="bg-white/90 backdrop-blur-sm border border-indigo-200/60 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 animate-fadeIn">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-indigo-600 border-r-indigo-300 border-b-transparent border-l-transparent animate-spin" />
              <FileSpreadsheet className="absolute inset-0 m-auto w-6 h-6 text-indigo-600" />
            </div>
            <p className="text-slate-700 text-sm font-semibold tracking-wide">Memproses file Excel...</p>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
