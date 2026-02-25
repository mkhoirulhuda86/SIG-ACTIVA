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

// Match text with keywords from database
// Parse natural language keyword input
const parseNaturalKeyword = (input: string): { keyword: string; type: string; result: string; priority: number } | null => {
  if (!input.trim()) return null;

  const text = input.toLowerCase();
  const original = input;

  // ── Extract result/output (text in quotes after "berisi", "maka berisi", etc.)
  let resultMatch = text.match(/(?:berisi|is|result|output|hasil)\s*["']([^"']+)["']/i);
  if (!resultMatch) resultMatch = text.match(/(?:berisi|is)\s+["']?([\w\s]+?)["']?$/i);

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
    // Extract all words in quotes: 'K3' dan 'SLA'  →  K3,SLA
    const quotedWords = [...original.matchAll(/["']([^"']+)["']/g)].map(m => m[1].trim());
    // Filter out the result value itself
    const resultVal = resultMatch[1].trim();
    const exclusions = quotedWords.filter(w => w.toLowerCase() !== resultVal.toLowerCase());
    if (exclusions.length > 0) {
      return { keyword: `not:${exclusions.join(',')}`, type, result: resultVal, priority };
    }
    // Fallback: try comma/atau separated words without quotes after "kata"
    const bareM = original.match(/(?:kata|text|teks)\s+([\w\s,\/|]+?)(?:\s+maka|\s+berisi|$)/i);
    if (bareM) {
      const words = bareM[1].trim().split(/\s*(?:,|atau|or|dan|and|\/|\|)\s*/).filter(Boolean);
      if (words.length > 0) {
        return { keyword: `not:${words.join(',')}`, type, result: resultVal, priority };
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
      // Detect if number/code suffix expected
      const hasNumber = /(?:nomor|angka|kode|aset|number|digit|\d)/.test(text);
      const hasFraction = /(?:karakter|huruf|kata|word|\\w)/.test(text);
      const suffix = hasNumber ? '\\d+' : hasFraction ? '\\w+' : '\\S+';
      // Result is dynamic (auto from match), so empty string = {match}
      return { keyword: `regex:${anchor} ${suffix}`, type, result: '', priority };
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
      return { keyword: `regex:${pattern}`, type, result, priority };
    }
  }

  // ── DocNo mode: "jika nomor dokumen / no dok / belegnummer diawali/= X maka berisi Y"
  const docnoM = original.match(
    /(?:nomor\s+dokumen|no\.?\s*dok(?:umen)?|doc(?:ument)?\s*no\.?|belegnummer)\s+(?:diawali|=|starts?\s*with|adalah|berisi|sama\s+dengan)\s+["']?([\w\d\*]+)["']?/i
  );
  if (docnoM && resultMatch) {
    const val = docnoM[1].replace(/\*$/, ''); // strip trailing wildcard — docno: always uses startsWith
    return { keyword: `docno:${val}`, type, result: resultMatch[1].trim(), priority };
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
      return { keyword: `col:${colName}:${pattern}`, type, result: resultMatch[1].trim(), priority };
    }
  }

  // ── Normal text mode: "jika ada text 'X' maka berisi 'Y'"
  let keywordMatch = original.match(/(?:jika ada text|text|keyword)\s*["']([^"']+)["']/i);
  if (!keywordMatch) keywordMatch = original.match(/(?:jika ada text|text)\s+([\w\s]+?)\s+(?:maka|then)/i);

  if (keywordMatch && resultMatch) {
    return { keyword: keywordMatch[1].trim(), type, result: resultMatch[1].trim(), priority };
  }
  if (keywordMatch) {
    return { keyword: keywordMatch[1].trim(), type, result: keywordMatch[1].trim(), priority };
  }

  return null;
};

const matchKeywords = (text: string, keywords: Keyword[], type: string, docno?: string, rowData?: Record<string, any>): string => {
  if (!keywords.length) return '';
  const textStr = String(text ?? '').trim();
  const textLower = textStr.toLowerCase();
  const docnoStr = String(docno ?? '').trim();
  
  // Filter by type and sort by priority (highest first)
  const relevantKeywords = keywords
    .filter((kw) => kw.type === type)
    .sort((a, b) => b.priority - a.priority);

  // Separate positive (including docno/col) and NOT keywords
  const positiveKeywords = relevantKeywords.filter(kw => !kw.keyword.toLowerCase().startsWith('not:'));
  const notKeywords = relevantKeywords.filter(kw => kw.keyword.toLowerCase().startsWith('not:'));

  // ── Pass 1: positive / regex / docno / col keywords (checked in priority order)
  for (const kw of positiveKeywords) {
    const kwLower = kw.keyword.toLowerCase();

    // ── Col mode: match against any column by header name
    // Syntax: col:NamaKolom:searchPattern
    if (kwLower.startsWith('col:')) {
      if (!rowData) continue;
      const withoutPrefix = kw.keyword.slice(4); // "NamaKolom:searchPattern"
      const colonIdx = withoutPrefix.indexOf(':');
      if (colonIdx < 0) continue;
      const colName = withoutPrefix.slice(0, colonIdx).trim();
      const pattern  = withoutPrefix.slice(colonIdx + 1).trim();
      // Find column value: exact header match first, then case-insensitive
      const colValue = (() => {
        const exactKey = Object.keys(rowData).find(k => k === colName);
        if (exactKey !== undefined) return String(rowData[exactKey] ?? '').trim();
        const ciKey = Object.keys(rowData).find(k => k.toLowerCase() === colName.toLowerCase());
        return ciKey ? String(rowData[ciKey] ?? '').trim() : '';
      })();
      if (!colValue) continue;
      let matched = false;
      if (pattern.toLowerCase().startsWith('regex:')) {
        try {
          const re = new RegExp(pattern.slice(6).trim(), 'i');
          matched = re.test(colValue);
        } catch (e) { console.warn('Invalid col regex:', kw.keyword); }
      } else if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.length > 2) {
        matched = colValue.toLowerCase().includes(pattern.slice(1, -1).toLowerCase());
      } else if (pattern.endsWith('*')) {
        matched = colValue.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
      } else if (pattern.startsWith('*')) {
        matched = colValue.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
      } else {
        // exact / contains
        matched = colValue.toLowerCase().includes(pattern.toLowerCase());
      }
      if (matched) return kw.result || colValue;
      continue;
    }

    // ── DocNo mode: match against document number column (column B)
    if (kwLower.startsWith('docno:')) {
      if (!docnoStr) continue;
      const pattern = kw.keyword.slice(6).trim();
      if (pattern.toLowerCase().startsWith('regex:')) {
        try {
          const regex = new RegExp(pattern.slice(6).trim(), 'i');
          if (regex.test(docnoStr)) return kw.result;
        } catch (e) {
          console.warn('Invalid docno regex:', kw.keyword);
        }
      } else {
        // Default: startsWith check (e.g. docno:18 matches "1800001234")
        if (docnoStr.startsWith(pattern)) return kw.result;
      }
      continue;
    }

    // ── Regex / Pattern mode (against text column)
    if (kwLower.startsWith('regex:')) {
      try {
        const pattern = kw.keyword.slice(6).trim();
        const regex = new RegExp(pattern, 'i');
        const match = textStr.match(regex);
        if (match) {
          if (!kw.result || kw.result.trim() === '{match}') return match[0];
          let result = kw.result;
          for (let i = 1; i < match.length; i++) {
            result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), match[i] ?? '');
          }
          result = result.replace(/\{match\}/gi, match[0]);
          return result;
        }
      } catch (e) {
        console.warn('Invalid regex pattern:', kw.keyword);
      }
      continue;
    }

    // ── Normal text includes matching
    const keywordLower = kw.keyword.toLowerCase();
    if (textLower.includes(keywordLower)) {
      return kw.result;
    }
  }

  // ── Pass 2: NOT keywords (only if no positive match)
  for (const kw of notKeywords) {
    // Syntax: "not:word1,word2" → match if text contains NONE of word1, word2
    const exclusions = kw.keyword.slice(4).trim().split(/[,|]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const hasExcluded = exclusions.some(excl => textLower.includes(excl));
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

type Keyword = {
  id: number;
  keyword: string;
  type: string;
  result: string;
  priority: number;
};

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
  
  // ── Keyword Management States ──────────────────────────────────────────────
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [showKeywordModal, setShowKeywordModal] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState<Keyword | null>(null);
  const [keywordForm, setKeywordForm] = useState({
    keyword: '',
    type: 'klasifikasi',
    result: '',
    priority: 0,
  });
  const [keywordFilter, setKeywordFilter] = useState<'all' | 'klasifikasi' | 'remark'>('all');
  const [inputMode, setInputMode] = useState<'simple' | 'advanced'>('simple');
  const [naturalInput, setNaturalInput] = useState('');
  const [keywordSearch, setKeywordSearch] = useState('');
  const [keywordPage, setKeywordPage] = useState(0);
  const KEYWORD_PAGE_SIZE = 20;
  const [kwMode, setKwMode] = useState<'normal' | 'regex' | 'not' | 'docno' | 'col'>('normal');
  const [colHeader, setColHeader] = useState('');
  const [colPattern, setColPattern] = useState('');

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
    loadKeywords();
  }, []);

  // ── Load keywords ──────────────────────────────────────────────────────────
  const loadKeywords = async () => {
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
  };

  // ── Load example keywords ──────────────────────────────────────────────────
  const handleLoadExamples = async () => {
    if (!confirm('Load contoh keywords? (Data existing tidak akan terhapus)')) return;
    try {
      const res = await fetch('/api/fluktuasi/keywords/seed', {
        method: 'POST',
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        loadKeywords();
      } else {
        alert(result.error);
      }
    } catch (error) {
      console.error('Error loading examples:', error);
      alert('Gagal load contoh keywords');
    }
  };

  // ── Check Duplicate Keyword ────────────────────────────────────────────────
  const checkDuplicateKeyword = (keyword: string, type: string, excludeId?: number): boolean => {
    const keywordLower = keyword.toLowerCase().trim();
    return keywords.some(kw => 
      kw.keyword.toLowerCase().trim() === keywordLower && 
      kw.type === type && 
      (!excludeId || kw.id !== excludeId)
    );
  };

  // ── Save/Update Keyword ────────────────────────────────────────────────────
  const handleSaveKeyword = async (formOverride?: any) => {
    try {
      const formToUse = formOverride || keywordForm;
      
      // Frontend validation for duplicate
      const isDuplicate = checkDuplicateKeyword(
        formToUse.keyword, 
        formToUse.type, 
        editingKeyword?.id
      );
      
      if (isDuplicate) {
        alert(`Keyword "${formToUse.keyword}" dengan type "${formToUse.type}" sudah ada. Silakan gunakan keyword yang berbeda.`);
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
        alert(result.message);
        loadKeywords();
        setShowKeywordModal(false);
        setEditingKeyword(null);
        setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0 });
        setNaturalInput('');
        setInputMode('simple');
        setKwMode('normal');
        setColHeader('');
        setColPattern('');
      } else {
        alert(result.error);
      }
    } catch (error) {
      console.error('Error saving keyword:', error);
      alert('Gagal menyimpan keyword');
    }
  };

  // ── Delete Keyword ─────────────────────────────────────────────────────────
  const handleDeleteKeyword = async (id: number) => {
    if (!confirm('Yakin hapus keyword ini?')) return;
    try {
      const res = await fetch(`/api/fluktuasi/keywords?id=${id}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        loadKeywords();
      } else {
        alert(result.error);
      }
    } catch (error) {
      console.error('Error deleting keyword:', error);
      alert('Gagal menghapus keyword');
    }
  };

  // ── Open Edit Modal ────────────────────────────────────────────────────────
  const handleEditKeyword = (kw: Keyword) => {
    setEditingKeyword(kw);
    setKeywordForm({ keyword: kw.keyword, type: kw.type, result: kw.result, priority: kw.priority });
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

        // Detect document number column (column B / SAP Belegnummer)
        const docnoColIdx = findColIdx(headers, [
          'Document No.', 'Doc. No.', 'Doc.No.', 'DocNo', 'Document Number',
          'Belegnummer', 'Belnr', 'Doc Number', 'No. Dokumen', 'Nomor Dokumen',
          'No Dokumen', 'Nomer Dokumen',
        ]);

        const rows: Record<string, any>[] = [];
        for (let r = headerRowIdx + 1; r < raw.length; r++) {
          const rawRow = raw[r];
          if (!rawRow || rawRow.every((c: any) => c === '' || c === null)) continue;
          const obj: Record<string, any> = {};
          headers.forEach((h, idx) => { obj[h] = rawRow[idx] ?? ''; });
          obj['__periode']     = parseDateToPeriode(dateColIdx >= 0 ? rawRow[dateColIdx] : '');
          
          // Use keyword matching for klasifikasi and remark
          const klasifikasiText = String(klasifikasiColIdx >= 0 ? rawRow[klasifikasiColIdx] : '');
          const remarkText = String(remarkColIdx >= 0 ? rawRow[remarkColIdx] : '');
          const docnoText = String(docnoColIdx >= 0 ? rawRow[docnoColIdx] : '');
          
          obj['__klasifikasi'] = matchKeywords(klasifikasiText, keywords, 'klasifikasi', docnoText, obj) || extractKlasifikasi(klasifikasiText);
          obj['__remark']      = matchKeywords(remarkText, keywords, 'remark', docnoText, obj) || remarkText.trim();
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

          {/* ── Master Keywords Card ───────────────────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Master Keywords</h2>
                  <p className="text-sm text-gray-500 mt-1">Kelola keyword untuk klasifikasi dan remark - digunakan otomatis saat upload file</p>
                </div>
                <div className="flex gap-2">
                  {keywords.length === 0 && (
                    <button
                      onClick={handleLoadExamples}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                    >
                      <Download size={16} />
                      Load Contoh
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingKeyword(null);
                      setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0 });
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
                  <div className="flex gap-2 mt-4">
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
                  <div className="mt-3">
                    <input
                      type="text"
                      value={keywordSearch}
                      onChange={(e) => { setKeywordSearch(e.target.value); setKeywordPage(0); }}
                      placeholder="Cari keyword..."
                      className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                    {keywordSearch && (
                      <p className="text-xs text-gray-500 mt-1">
                        Menampilkan {keywords.filter(kw => keywordFilter === 'all' || kw.type === keywordFilter).filter(kw => {
                          const search = keywordSearch.toLowerCase();
                          return kw.keyword.toLowerCase().includes(search) || kw.result.toLowerCase().includes(search);
                        }).length} dari {keywords.filter(kw => keywordFilter === 'all' || kw.type === keywordFilter).length} keyword
                      </p>
                    )}
                  </div>
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
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(() => {
                    const filteredKeywords = keywords
                      .filter(kw => keywordFilter === 'all' || kw.type === keywordFilter)
                      .filter(kw => {
                        if (!keywordSearch) return true;
                        const search = keywordSearch.toLowerCase();
                        return (
                          kw.keyword.toLowerCase().includes(search) ||
                          kw.result.toLowerCase().includes(search)
                        );
                      })
                      .sort((a, b) => b.priority - a.priority);
                    
                    if (keywords.length === 0) {
                      return (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center">
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
                          <td colSpan={5} className="px-4 py-8 text-center">
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
                        <tr key={kw.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
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
              const filteredKeywords = keywords
                .filter(kw => keywordFilter === 'all' || kw.type === keywordFilter)
                .filter(kw => {
                  if (!keywordSearch) return true;
                  const search = keywordSearch.toLowerCase();
                  return (
                    kw.keyword.toLowerCase().includes(search) ||
                    kw.result.toLowerCase().includes(search)
                  );
                });
              
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
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Menampilkan {keywordPage * KEYWORD_PAGE_SIZE + 1} - {Math.min((keywordPage + 1) * KEYWORD_PAGE_SIZE, filteredKeywords.length)} dari {filteredKeywords.length} keyword
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

      {/* ── Keyword Modal ─────────────────────────────────────────────────── */}
      {showKeywordModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">
                {editingKeyword ? 'Edit Keyword' : 'Tambah Keyword Baru'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Keyword akan digunakan untuk matching otomatis saat upload file
              </p>
              
              {/* Input Mode Toggle */}
              {!editingKeyword && (
                <div className="flex gap-2 mt-4">
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
            
            <div className="p-6 space-y-5">
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
                    </ul>
                  </div>
                  
                  {/* Preview parsed result */}
                  {naturalInput && (() => {
                    const parsed = parseNaturalKeyword(naturalInput);
                    if (parsed) {
                      const isDuplicate = checkDuplicateKeyword(parsed.keyword, parsed.type);
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
                              keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, editingKeyword?.id)
                                ? 'border-red-300 focus:ring-red-500 focus:border-red-500 bg-red-50'
                                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                            }`}
                          />
                        </div>
                        {keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, editingKeyword?.id) && (
                          <p className="text-xs text-red-600 mt-1.5 font-medium">Keyword ini sudah ada untuk type {keywordForm.type}</p>
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
                    {keywordForm.keyword && checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, editingKeyword?.id) && (
                      <p className="text-xs text-red-600 mt-1.5 font-medium">
                        Kombinasi keyword "{keywordForm.keyword}" dengan type "{keywordForm.type}" sudah ada
                      </p>
                    )}
                    {(!keywordForm.keyword || !checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, editingKeyword?.id)) && (
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
                </>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => {
                  setShowKeywordModal(false);
                  setEditingKeyword(null);
                  setKeywordForm({ keyword: '', type: 'klasifikasi', result: '', priority: 0 });
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
                    const parsed = parseNaturalKeyword(naturalInput);
                    if (!parsed) return true;
                    return checkDuplicateKeyword(parsed.keyword, parsed.type);
                  } else {
                    // Advanced mode validation
                    if (!keywordForm.keyword) return true;
                    // col mode: need colHeader to be set
                    if (kwMode === 'col' && !colHeader) return true;
                    // Regex, NOT, col modes: result is optional
                    const isSpecialMode = keywordForm.keyword.toLowerCase().startsWith('regex:') || keywordForm.keyword.toLowerCase().startsWith('not:') || keywordForm.keyword.toLowerCase().startsWith('col:');
                    if (!isSpecialMode && !keywordForm.result) return true;
                    return checkDuplicateKeyword(keywordForm.keyword, keywordForm.type, editingKeyword?.id);
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

    </div>
  );
}
