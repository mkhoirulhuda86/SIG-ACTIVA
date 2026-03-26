'use client';

import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import dynamic from 'next/dynamic';
import { RotateCcw, Search, TrendingUp, Layers, Filter, List, BarChart3 } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Bar as ChartBar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip as ChartTooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { ScrollArea } from '../components/ui/scroll-area';

const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });
const Header  = dynamic(() => import('../components/Header'),  { ssr: false });

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend, ChartDataLabels);

// --- Types -------------------------------------------------------------------
type AkunPeriodeRecord = {
  id?: number;
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi?: string;
  remark?: string;
  reasonMoM?: string;
  reasonYoY?: string;
  reasonYtD?: string;
};

type DetailFrameRow = {
  klasifikasi: string;
  prev: number;
  curr: number;
  delta: number;
  reason: string;
  reasons: string[];
};

// --- Helpers -----------------------------------------------------------------
const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

type FrameKey = 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';

type RekapSheetRow = {
  type?: 'category' | 'detail' | 'amount';
  category?: string;
  detail?: string;
  values?: unknown[];
};

type RekapData = {
  rekapSheetData?: { rows?: RekapSheetRow[] };
};

const EXCLUDED_PARENT_ACCOUNT_CODES_DETAIL = new Set([
  '71510000', '71400000', '71560000', '71300000', '71600000',
]);

const parseFrameKeyFromCategory = (desc: string): FrameKey | null => {
  const s = String(desc || '').toLowerCase();
  if (s.includes('bunga')) return 'beban-bunga';
  if (s.includes('lain')) return 'pendapatan-lain';
  if (s.includes('kurs')) return 'selisih-kurs';
  if (s.includes('bunga')) return 'pendapatan-bunga';
  return null;
};

// Build frame account mapping from rekap sheet (source of truth)
const buildFrameAccountsFromRekapDetail = (rekapData: RekapData | null | undefined): Record<FrameKey, Set<string>> => {
  const out: Record<FrameKey, Set<string>> = {
    'beban-bunga': new Set<string>(),
    'pendapatan-lain': new Set<string>(),
    'pendapatan-bunga': new Set<string>(),
    'selisih-kurs': new Set<string>(),
  };

  const rows = rekapData?.rekapSheetData?.rows;
  if (!Array.isArray(rows)) return out;

  let currentFrame: FrameKey | null = null;
  for (const row of rows) {
    const values = Array.isArray(row?.values) ? row.values : [];
    const accountCode = String(values[0] ?? '').trim();
    const description = String(values[1] ?? '').trim();

    if (row?.type === 'category') {
      currentFrame = parseFrameKeyFromCategory(description);
      continue;
    }

    if (row?.type !== 'detail') continue;
    if (!currentFrame) continue;
    if (!/^\d{5,}$/.test(accountCode)) continue;
    if (EXCLUDED_PARENT_ACCOUNT_CODES_DETAIL.has(accountCode)) continue;

    out[currentFrame].add(accountCode);
  }

  return out;
};

const fmtCompact = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1_000_000)     return sign + Math.round(a / 1_000_000).toLocaleString('id-ID') + ' JT';
  if (a >= 1_000)         return sign + Math.round(a / 1_000).toLocaleString('id-ID') + ' RB';
  return sign + Math.round(a).toLocaleString('id-ID');
};

// Cached formatter — avoids allocating a new Intl instance on every call
const _fmtFull = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const fmtFull = (n: number): string => _fmtFull.format(n);

const summarizeAccountFrameReason = (
  rows: DetailFrameRow[],
  mode: 'mom' | 'yoy' | 'ytd',
): string => {
  if (rows.length === 0) return '-';

  const movers = rows.map((row) => ({ ...row, delta: row.curr - row.prev }));
  const nonZero = movers.filter((m) => m.delta !== 0);
  if (nonZero.length === 0) {
    return `Tidak ada perubahan ${mode.toUpperCase()} yang signifikan untuk akun ini.`;
  }

  const topNaik = nonZero
    .filter((m) => m.delta > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const topTurun = nonZero
    .filter((m) => m.delta < 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const netDelta = nonZero.reduce((s, m) => s + m.delta, 0);
  let summary = `${mode.toUpperCase()}: nilai akun ${netDelta >= 0 ? 'naik' : 'turun'} ${fmtCompact(Math.abs(netDelta))}.`;

  if (topNaik) summary += ` Naik terbesar: ${topNaik.klasifikasi} ${fmtCompact(Math.abs(topNaik.delta))}.`;
  if (topTurun) summary += ` Turun terbesar: ${topTurun.klasifikasi} ${fmtCompact(Math.abs(topTurun.delta))}.`;

  return summary;
};

// Cached periode label map to avoid repeated string splits
const _periodeCache = new Map<string, string>();
const periodeToLabel = (p: string): string => {
  const cached = _periodeCache.get(p);
  if (cached) return cached;
  const [yr, mo] = p.split('.');
  const m = parseInt(mo) - 1;
  const label = `${MONTHS_ID[m] ?? mo} ${yr}`;
  _periodeCache.set(p, label);
  return label;
};

const PALETTE = [
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#ea580c','#0891b2','#15803d','#9333ea','#ca8a04',
  '#4f46e5','#e11d48','#0d9488','#b45309','#6d28d9',
  '#be123c','#065f46','#1e40af','#92400e','#4338ca',
];

// Order matters: more-specific prefixes first
const SUB_GROUP_PREFIXES: { prefix: string; label: string; color: string }[] = [
  { prefix: '7156', label: '71400000', color: '#16a34a' },
  { prefix: '713',  label: '71300000', color: '#2563eb' },
  { prefix: '714',  label: '71400000', color: '#16a34a' },
  { prefix: '715',  label: '71510000', color: '#d97706' },
  { prefix: '716',  label: '71600000', color: '#7c3aed' },
];
const SUB_AKUN_GROUPS = [
  { label: '71300000', color: '#2563eb' },
  { label: '71400000', color: '#16a34a' },
  { label: '71510000', color: '#d97706' },
  { label: '71600000', color: '#7c3aed' },
];

const EXCLUDED_PARENT_ACCOUNT_CODES = new Set([
  '71510000',
  '71400000',
  '71560000',
  '71300000',
  '71600000',
]);

type AccountTabDef = {
  key: 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';
  title: string;
  accountCodes: string[];
};

const ACCOUNT_TAB_DEFS: AccountTabDef[] = [
  {
    key: 'beban-bunga',
    title: 'Beban Bunga',
    accountCodes: [
      '71510001',
      '71510002',
      '71510003',
      '71510004',
      '71510005',
      '71510098',
      '71510099',
    ],
  },
  {
    key: 'pendapatan-lain',
    title: 'Pendapatan Lain-Lain',
    accountCodes: [
      '71410001',
      '71410009',
      '71421001',
      '71421002',
      '71421009',
      '71430001',
      '71430002',
      '71440001',
      '71460001',
      '71460002',
      '71460009',
      '71560001',
    ],
  },
  {
    key: 'pendapatan-bunga',
    title: 'Pendapatan Bunga',
    accountCodes: [
      '71310001',
      '71310002',
      '71320001',
      '71320002',
    ],
  },
  {
    key: 'selisih-kurs',
    title: 'Laba (Rugi) Selisih Kurs',
    accountCodes: [
      '71610001',
      '71610002',
      '71620001',
      '71620002',
      '71620004',
    ],
  },
];

const ACCOUNT_NAMES: Record<string, string> = {
  '71510000': 'BEBAN BUNGA PINJAMAN',
  '71510001': 'BEBAN BUNGA PINJAMAN INVESTASI',
  '71510002': 'BEBAN BUNGA PINJAMAN MODAL KERJA',
  '71510003': 'BEBAN BUNGA OBLIGASI',
  '71510004': 'BEBAN BUNGA SEWA PEMBIAYAAN',
  '71510005': 'DERIVATIVE INSTRUMENT INTEREST EXPENSES',
  '71510098': 'BEBAN BUNGA (PSAK 57)',
  '71510099': 'BEBAN BUNGA LAIN - LAIN',
  '71400000': 'PENDAPATAN KLAIM',
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
  '71560000': 'BEBAN LAIN-LAINNYA',
  '71560001': 'BEBAN LAIN-LAINNYA',
  '71300000': 'PENDAPATAN BUNGA',
  '71310001': 'PENDAPATAN BUNGA DEPOSITO',
  '71310002': 'PENDAPATAN JASA GIRO',
  '71320001': 'PENDAPATAN CICILAN',
  '71320002': 'PENDAPATAN BUNGA OBLIGASI',
  '71600000': 'LABA (RUGI) SELISIH KURS',
  '71610001': 'LABA SELISIH KURS [REALISED]',
  '71610002': 'RUGI SELISIH KURS [REALISED]',
  '71620001': 'LABA SELISIH KURS [UNREALISED]',
  '71620002': 'RUGI SELISIH KURS [UNREALISED]',
  '71620004': 'EXCHANGE RATE DIFFERENCE UTK PEMBELIAN',
};

// ═══ Klasifikasi Validation Rules (per-account detail) ═════════════════════
const isKlasifikasiValidForDetailTab = (tabKey: AccountTabDef['key'], klasifikasi: string): boolean => {
  const k = String(klasifikasi || '').trim().toLowerCase();
  if (!k) return false;

  // Rule: "Kor. Tagihan Air" hanya boleh di pendapatan-lain
  if (/^kor\.?\s*tagihan\s*air$/.test(k) && tabKey !== 'pendapatan-lain') {
    return false;
  }

  return true;
};

type SeriesColors = {
  prev: string;
  curr: string;
  prevText: string;
  currText: string;
};

const SOFT_BLUE_2025 = '#7fb3ff';
const NAVY_2026 = '#1e3a8a';

const extractYearFromLabel = (label: string): string => {
  const m = String(label || '').match(/(20\d{2})/);
  return m?.[1] ?? '';
};

const resolveDetailSeriesColors = (labelPrev: string, labelCurr: string): SeriesColors => {
  const prevYear = extractYearFromLabel(labelPrev);
  const currYear = extractYearFromLabel(labelCurr);

  const colorForYear = (year: string, fallback: string) => {
    if (year === '2025') return SOFT_BLUE_2025;
    if (year === '2026') return NAVY_2026;
    return fallback;
  };

  let colors: SeriesColors = {
    prev: colorForYear(prevYear, '#5fa3f4'),
    curr: colorForYear(currYear, '#243b73'),
    prevText: colorForYear(prevYear, '#2f6fbe'),
    currText: colorForYear(currYear, '#172a57'),
  };

  if (prevYear && currYear && prevYear === currYear) {
    colors = {
      prev: SOFT_BLUE_2025,
      curr: NAVY_2026,
      prevText: '#2f6fbe',
      currText: '#132657',
    };
  }

  return colors;
};

const buildDetailChartData = (
  rows: { klasifikasi: string; prev: number; curr: number }[],
  labelPrev: string,
  labelCurr: string,
): ChartData<'bar'> => {
  const colors = resolveDetailSeriesColors(labelPrev, labelCurr);
  return {
    labels: rows.map((r) => r.klasifikasi),
    datasets: [
      {
        label: labelPrev,
        data: rows.map((r) => r.prev),
        backgroundColor: colors.prev,
        borderRadius: 0,
        borderSkipped: false,
        minBarLength: 2,
        categoryPercentage: 0.8,
        barPercentage: 1,
        inflateAmount: 0,
      },
      {
        label: labelCurr,
        data: rows.map((r) => r.curr),
        backgroundColor: colors.curr,
        borderRadius: 0,
        borderSkipped: false,
        minBarLength: 2,
        categoryPercentage: 0.8,
        barPercentage: 1,
        inflateAmount: 0,
      },
    ],
  };
};

const buildDetailChartOptions = (isCompact: boolean, labelPrev: string, labelCurr: string): ChartOptions<'bar'> => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  layout: {
    padding: { top: 2, right: 2, left: 2, bottom: 0 },
  },
  plugins: {
    legend: { display: false },
    datalabels: {
      display: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        return !isCompact || v === 0;
      },
      anchor: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        return v === 0 ? 'center' : 'end';
      },
      align: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        return v === 0 ? 'top' : 'end';
      },
      offset: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        return v === 0 ? 6 : 2;
      },
      clamp: true,
      clip: false,
      font: {
        size: 9,
        weight: 700,
      },
      color: (ctx: any) => {
        const c = resolveDetailSeriesColors(labelPrev, labelCurr);
        return ctx.datasetIndex === 0 ? c.prevText : c.currText;
      },
      formatter: (value: unknown) => fmtCompact(Number(value ?? 0)),
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${fmtCompact(Number(ctx.parsed.y ?? 0))}`,
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: '#64748b',
        font: { size: isCompact ? 7 : 8 },
        maxRotation: isCompact ? 24 : 12,
        minRotation: isCompact ? 24 : 12,
        callback: function(value) {
          const raw = typeof this.getLabelForValue === 'function' ? this.getLabelForValue(Number(value)) : value;
          const label = String(raw ?? '');
          const cap = isCompact ? 14 : 22;
          return label.length > cap ? `${label.slice(0, cap)}...` : label;
        },
      },
      grid: { color: '#e2e8f0' },
    },
    y: {
      grace: '8%',
      ticks: {
        color: '#64748b',
        font: { size: isCompact ? 8 : 9 },
        callback: (value) => fmtCompact(Number(value ?? 0)),
      },
      grid: { color: '#e2e8f0' },
    },
  },
});

// Pre-built cache: code prefix → sub-group (O(1) lookup per code)
const _subGroupCache = new Map<string, { prefix: string; label: string; color: string } | null>();
const subGroupForCode = (code: string) => {
  const key = code.slice(0, 6); // longest prefix is 4 chars, so 6 is safe
  const cached = _subGroupCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const found = SUB_GROUP_PREFIXES.find(g => code.startsWith(g.prefix)) ?? null;
  _subGroupCache.set(key, found);
  return found ?? undefined;
};

// --- Animated Counter Hook --------------------------------------------------
function useAnimatedCounter(target: number, deps: unknown[] = []) {
  const displayRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = displayRef.current;
    if (!el) return;
    const proxy = { value: 0 };
    animate(proxy, {
      value: target,
      duration: 1200,
      ease: 'easeOutExpo',
      onUpdate: () => {
        el.textContent = fmtFull(Math.round(proxy.value));
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
  return displayRef;
}

// --- Donut Chart with anime.js slice animation --------------------------------
function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const paths = svgRef.current?.querySelectorAll('path[data-slice]');
    if (!paths || paths.length === 0) return;
    // Use only opacity — SVG paths cannot use CSS scale via anime.js
    animate(paths, {
      opacity: [0, 1],
      duration: 600,
      delay: stagger(50),
      ease: 'easeOutQuad',
    });
  }, [data]);

  if (total === 0) return (
    <div className="flex items-center justify-center" style={{ width: 200, height: 200 }}>
      <span className="text-slate-400 text-xs">No data</span>
    </div>
  );
  const R = 80, r = 50, cx = 100, cy = 100;
  const dataSum = data.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
  let angle = -90;
  const slices = data.map(d => {
    const sweep = (Math.abs(d.value) / dataSum) * 360;
    const start = angle;
    angle += sweep;
    return { ...d, startAngle: start, sweep };
  });
  const polarToXY = (pcx: number, pcy: number, radius: number, deg: number) => ({
    x: pcx + radius * Math.cos((deg * Math.PI) / 180),
    y: pcy + radius * Math.sin((deg * Math.PI) / 180),
  });
  const arcPath = (pcx: number, pcy: number, oR: number, ir: number, sa: number, sw: number) => {
    if (sw >= 359.9) {
      const top = polarToXY(pcx, pcy, oR, sa);
      const bot = polarToXY(pcx, pcy, oR, sa + 180);
      const ti  = polarToXY(pcx, pcy, ir, sa);
      const bi  = polarToXY(pcx, pcy, ir, sa + 180);
      return `M ${top.x} ${top.y} A ${oR} ${oR} 0 1 1 ${bot.x} ${bot.y} A ${oR} ${oR} 0 1 1 ${top.x} ${top.y} Z M ${ti.x} ${ti.y} A ${ir} ${ir} 0 1 0 ${bi.x} ${bi.y} A ${ir} ${ir} 0 1 0 ${ti.x} ${ti.y} Z`;
    }
    const ea = sa + sw;
    const s1 = polarToXY(pcx, pcy, oR, sa);
    const e1 = polarToXY(pcx, pcy, oR, ea);
    const s2 = polarToXY(pcx, pcy, ir, ea);
    const e2 = polarToXY(pcx, pcy, ir, sa);
    const large = sw > 180 ? 1 : 0;
    return `M ${s1.x} ${s1.y} A ${oR} ${oR} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${ir} ${ir} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
  };
  return (
    <svg ref={svgRef} viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="#f1f5f9" />
      {slices.map((s, i) => (
        <path
          key={i}
          data-slice="true"
          d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)}
          fill={s.color}
          style={{ opacity: 0 }}
        />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="white" />
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#1e293b" fontSize={13} fontWeight="800">
        {fmtCompact(total)}
      </text>
      <text x={cx} y={cy + 7} textAnchor="middle" fill="#94a3b8" fontSize={8}>
        Total Outstanding
      </text>
    </svg>
  );
}

// --- Trend Chart with GSAP draw animation ------------------------------------
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  const polylineRef = useRef<SVGPolylineElement>(null);
  const polygonRef  = useRef<SVGPolygonElement>(null);

  useEffect(() => {
    const line = polylineRef.current;
    const area = polygonRef.current;
    if (!line || !area) return;
    let totalLen = 800;
    try { totalLen = line.getTotalLength(); } catch { /* fallback */ }
    // Use GSAP attr for SVG properties to avoid CSS/SVG mismatch
    gsap.set(line, { attr: { 'stroke-dasharray': totalLen, 'stroke-dashoffset': totalLen }, opacity: 1 });
    gsap.set(area, { opacity: 0 });
    gsap.to(line,  { attr: { 'stroke-dashoffset': 0 }, duration: 1.4, ease: 'power3.out', delay: 0.1 });
    gsap.to(area,  { opacity: 1, duration: 0.8, delay: 0.8, ease: 'power2.out' });
  }, [data]);

  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-slate-400 text-xs">Butuh lebih dari 1 periode</span>
    </div>
  );
  const W = 480, H = 130, PX = 44, PY = 16;
  const vals  = data.map(d => d.value);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range = maxV - minV || 1;
  const toX = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const toY = (v: number) => PY + ((maxV - v) / range) * (H - PY * 2 - 14);
  const pts  = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const areaPoints = [
    `${toX(0)},${H - 14}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${H - 14}`,
  ].join(' ');
  const step = data.length > 12 ? Math.ceil(data.length / 10) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <defs>
        <linearGradient id="trendGradAkun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y   = PY + t * (H - PY * 2 - 14);
        const val = maxV - t * range;
        return (
          <g key={t}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="#e2e8f0" strokeWidth={0.8} />
            <text x={PX - 4} y={y + 2} textAnchor="end" fill="#94a3b8" fontSize={7}>
              {fmtCompact(val)}
            </text>
          </g>
        );
      })}
      <polygon ref={polygonRef} points={areaPoints} fill="url(#trendGradAkun)" style={{ opacity: 0 }} />
      <polyline ref={polylineRef} points={pts} fill="none" stroke="#2563eb" strokeWidth={2.2} strokeLinejoin="round" strokeDasharray="9999" strokeDashoffset="9999" style={{ opacity: 0 }} />
      {data.map((d, i) => {
        const showDot   = data.length <= 30;
        const showLabel = i % step === 0 || i === data.length - 1;
        return (
          <g key={i}>
            {showDot && (
              <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#2563eb" stroke="white" strokeWidth={1}
                style={{ opacity: 0, animation: `fadeInDot 0.3s ease ${0.8 + i * 0.02}s forwards` }} />
            )}
            {showLabel && (
              <text x={toX(i)} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize={7}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      <style>{`@keyframes fadeInDot { from { opacity:0; transform:scale(0); transform-box:fill-box; transform-origin:center; } to { opacity:1; transform:scale(1); } }`}</style>
    </svg>
  );
}

// --- Skeleton Loading State --------------------------------------------------
function PageSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-3 pb-1">
        <div className="border border-blue-100 bg-[#eef5ff] shadow-sm rounded-lg">
          <div className="p-2 pb-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-40" />
              <div className="ml-auto flex gap-1">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-5 w-10 rounded" />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="ml-auto h-3 w-40" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-7 w-28 rounded-md" />
              ))}
            </div>
          </div>

          <div className="p-2 pt-1">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="border border-slate-200 shadow-sm bg-white rounded-lg">
                  <div className="p-2 pb-1">
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <div className="p-2 pt-0">
                    <Skeleton className="h-[250px] w-full rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pb-4" />

      {/* Centered loading overlay */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center">
        <div className="bg-white/90 backdrop-blur-sm border border-blue-200/60 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
            <div className="absolute inset-0 rounded-full border-4 border-t-blue-600 border-r-blue-300 border-b-transparent border-l-transparent animate-spin" />
            <BarChart3 className="absolute inset-0 m-auto w-6 h-6 text-blue-600" />
          </div>
          <p className="text-slate-700 text-sm font-semibold tracking-wide">Memuat data fluktuasi...</p>
          <div className="flex gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Pre-processed record type ----------------------------------------------
type ProcessedRecord = AkunPeriodeRecord & { _parts: string[] };

// --- Main Component ----------------------------------------------------------
export default function DetailAkunFluktuasiPage() {
  const [records, setRecords]                   = useState<ProcessedRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [frameAccountsMap, setFrameAccountsMap] = useState<Record<FrameKey, Set<string>>>({
    'beban-bunga': new Set(),
    'pendapatan-lain': new Set(),
    'pendapatan-bunga': new Set(),
    'selisih-kurs': new Set(),
  });
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);
  const [isCompact, setIsCompact]               = useState(false);
  const [activeReasonAccountCode, setActiveReasonAccountCode] = useState<string | null>(null);
  const [compMode, setCompMode]                 = useState<'mom' | 'yoy' | 'ytd'>('yoy');
  const [compPeriodeRaw, setCompPeriodeRaw]     = useState('');
  const [activeAccountTab, setActiveAccountTab] = useState<AccountTabDef['key']>('beban-bunga');

  // Filters
  const [selectedYear,      setSelectedYear]      = useState<string>('all');
  const [searchAkunRaw,     setSearchAkunRaw]     = useState('');
  const [filterAkun,        setFilterAkun]        = useState<Set<string>>(new Set());
  const [filterKlasifikasi, setFilterKlasifikasi] = useState<Set<string>>(new Set());
  const [filterSubAkun,     setFilterSubAkun]     = useState<Set<string>>(new Set());

  // Debounce search input to avoid re-filtering on every keystroke
  const searchAkun = useDeferredValue(searchAkunRaw);

  // Listing
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 50;

  // Animation refs
  const pillsRef     = useRef<HTMLDivElement>(null);
  const donutCardRef = useRef<HTMLDivElement>(null);
  const centerColRef = useRef<HTMLDivElement>(null);
  const filterColRef = useRef<HTMLDivElement>(null);
  const tableRef     = useRef<HTMLDivElement>(null);
  const resetBtnRef  = useRef<HTMLButtonElement>(null);
  const akunListRef  = useRef<HTMLDivElement>(null);
  const klasListRef    = useRef<HTMLDivElement>(null);
  const subAkunListRef = useRef<HTMLDivElement>(null);
  const tableBodyRef   = useRef<HTMLTableSectionElement>(null);
  const reasonOverlayRef = useRef<HTMLDivElement>(null);
  const reasonPanelRef = useRef<HTMLDivElement>(null);
  const reasonListRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      // Fetch full rekap data to build frame account mapping
      const resFluktuasi = await fetch('/api/fluktuasi');
      const dataFluktuasi = await resFluktuasi.json();
      const rekap = dataFluktuasi?.data as RekapData | undefined;
      const frameAccounts = buildFrameAccountsFromRekapDetail(rekap);
      setFrameAccountsMap(frameAccounts);

      // Primary source: rekap-amounts (covers full imported rekap data)
      const resRekap = await fetch('/api/fluktuasi/rekap-amounts');
      const dataRekap = await resRekap.json();

      let sourceRows: AkunPeriodeRecord[] = [];
      if (dataRekap?.success && Array.isArray(dataRekap.data) && dataRekap.data.length > 0) {
        sourceRows = dataRekap.data as AkunPeriodeRecord[];
      } else {
        // Fallback for legacy data path
        const resAkun = await fetch('/api/fluktuasi/akun-periodes?slim=1');
        const dataAkun = await resAkun.json();
        if (dataAkun?.success && Array.isArray(dataAkun.data)) {
          sourceRows = dataAkun.data as AkunPeriodeRecord[];
        }
      }

      const processed: ProcessedRecord[] = sourceRows.map((r) => {
        const klasifikasiRaw = (r.klasifikasi || r.reasonMoM || '(Tanpa Klasifikasi)').toString();
        return {
          ...r,
          accountCode: String(r.accountCode || '').trim(),
          periode: String(r.periode || '').trim(),
          amount: Number(r.amount || 0),
          _parts: klasifikasiRaw.split(';').map((p: string) => p.trim()).filter(Boolean),
        };
      });

      setRecords(processed);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const _fluktuasiDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeUpdates(['fluktuasi'], useCallback(() => {
    if (_fluktuasiDebounce.current) clearTimeout(_fluktuasiDebounce.current);
    _fluktuasiDebounce.current = setTimeout(loadData, 400);
  }, [loadData]));;

  // ── GSAP page-entry after data loads ────────────────────────────────────
  useEffect(() => {
    if (loading || records.length === 0) return;
    const animTargets = [
      pillsRef.current,
      donutCardRef.current,
      centerColRef.current,
      filterColRef.current,
      tableRef.current,
    ].filter((el): el is HTMLDivElement => el !== null);

    if (animTargets.length === 0) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        animTargets,
        { opacity: 0, y: 18, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out' }
      );
    });
    return () => ctx.revert();
  }, [loading, records.length]);

  // ── Animate akun filter items when search or selection changes ───────────
  useEffect(() => {
    if (!akunListRef.current) return;
    const items = Array.from(akunListRef.current.querySelectorAll('.akun-item')).slice(0, 40);
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateX: [10, 0],
      duration: 240,
      delay: stagger(18),
      ease: 'easeOutExpo',
    });
  }, [filterAkun, searchAkun]);

  // ── Animate klasifikasi items ────────────────────────────────────────────
  useEffect(() => {
    if (!klasListRef.current) return;
    const items = Array.from(klasListRef.current.querySelectorAll('.klas-item')).slice(0, 30);
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateX: [8, 0],
      duration: 220,
      delay: stagger(16),
      ease: 'easeOutExpo',
    });
  }, [filterKlasifikasi]);

  // ── Animate sub-akun filter items ────────────────────────────────────────
  useEffect(() => {
    if (!subAkunListRef.current) return;
    const items = Array.from(subAkunListRef.current.querySelectorAll('.sub-akun-item')).slice(0, 10);
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateX: [8, 0],
      duration: 220,
      delay: stagger(16),
      ease: 'easeOutExpo',
    });
  }, [filterSubAkun]);

  // ── Animate table rows on page/filter change ─────────────────────────────
  useEffect(() => {
    if (!tableBodyRef.current) return;
    // Only animate visible rows, cap at 30 to avoid jank on large pages
    const rows = Array.from(tableBodyRef.current.querySelectorAll('tr')).slice(0, 30);
    if (!rows.length) return;
    animate(rows, {
      opacity: [0, 1],
      translateY: [6, 0],
      duration: 220,
      delay: stagger(12),
      ease: 'easeOutExpo',
    });
  }, [listPage, filterSubAkun, filterAkun, filterKlasifikasi, selectedYear]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const years = useMemo(() => {
    const s = new Set(records.map(r => r.periode.split('.')[0]));
    return [...s].sort();
  }, [records]);

  const allPeriodes = useMemo(() => {
    const s = new Set(records.map(r => r.periode));
    return [...s].sort();
  }, [records]);

  const compPeriode = compPeriodeRaw || (allPeriodes.length > 0 ? allPeriodes[allPeriodes.length - 1] : '');

  const activeTabDef = useMemo(
    () => ACCOUNT_TAB_DEFS.find(t => t.key === activeAccountTab) || ACCOUNT_TAB_DEFS[0],
    [activeAccountTab],
  );

  const accountFramesByMode = useMemo(() => {
    if (!compPeriode) {
      return {
        frames: [] as { accountCode: string; rows: { klasifikasi: string; prev: number; curr: number }[]; detailRows: DetailFrameRow[]; frameReason: string }[],
        labelA: '',
        labelB: '',
      };
    }

    const [yearStr, monStr] = compPeriode.split('.');
    const yearA = parseInt(yearStr);
    const monA = parseInt(monStr);

    let periodesA: Set<string>;
    let periodesB: Set<string>;
    let labelA: string;
    let labelB: string;

    if (compMode === 'mom') {
      const prevMon = monA === 1 ? 12 : monA - 1;
      const prevYear = monA === 1 ? yearA - 1 : yearA;
      const periodeB = `${prevYear}.${String(prevMon).padStart(2, '0')}`;
      periodesA = new Set([compPeriode]);
      periodesB = new Set([periodeB]);
      labelA = periodeToLabel(compPeriode);
      labelB = periodeToLabel(periodeB);
    } else if (compMode === 'yoy') {
      const periodeB = `${yearA - 1}.${monStr}`;
      periodesA = new Set([compPeriode]);
      periodesB = new Set([periodeB]);
      labelA = periodeToLabel(compPeriode);
      labelB = periodeToLabel(periodeB);
    } else {
      periodesA = new Set<string>();
      periodesB = new Set<string>();
      for (let m = 1; m <= monA; m++) {
        periodesA.add(`${yearA}.${String(m).padStart(2, '0')}`);
        periodesB.add(`${yearA - 1}.${String(m).padStart(2, '0')}`);
      }
      labelA = `YTD ${yearA}`;
      labelB = `YTD ${yearA - 1}`;
    }

    const allowedCodes = new Set(
      frameAccountsMap[activeAccountTab]?.size > 0
        ? frameAccountsMap[activeAccountTab]
        : activeTabDef.accountCodes.filter((code) => !EXCLUDED_PARENT_ACCOUNT_CODES.has(code))
    );
    const accountMap = new Map<string, { mapA: Map<string, number>; mapB: Map<string, number>; reasonMap: Map<string, Set<string>> }>();

    for (const code of allowedCodes) {
      accountMap.set(code, { mapA: new Map<string, number>(), mapB: new Map<string, number>(), reasonMap: new Map<string, Set<string>>() });
    }

    for (const r of records) {
      if (!allowedCodes.has(r.accountCode)) continue;

      let entry = accountMap.get(r.accountCode);
      if (!entry) {
        entry = { mapA: new Map<string, number>(), mapB: new Map<string, number>(), reasonMap: new Map<string, Set<string>>() };
        accountMap.set(r.accountCode, entry);
      }

      const klasifikasiParts = r._parts
        .filter(k => isKlasifikasiValidForDetailTab(activeAccountTab, k))
        .filter(Boolean);
      if (klasifikasiParts.length === 0) continue;

      const share = r.amount / klasifikasiParts.length;
      const reasonRaw = compMode === 'mom' ? r.reasonMoM : compMode === 'yoy' ? r.reasonYoY : r.reasonYtD;
      const reasonList = String(reasonRaw || '').split(';').map(s => s.trim()).filter(Boolean);
      if (reasonList.length > 0) {
        for (const klasifikasi of klasifikasiParts) {
          const rs = entry.reasonMap.get(klasifikasi) ?? new Set<string>();
          for (const reason of reasonList) rs.add(reason);
          entry.reasonMap.set(klasifikasi, rs);
        }
      }

      if (periodesA.has(r.periode)) {
        for (const klasifikasi of klasifikasiParts) {
          entry.mapA.set(klasifikasi, (entry.mapA.get(klasifikasi) ?? 0) + share);
        }
      } else if (periodesB.has(r.periode)) {
        for (const klasifikasi of klasifikasiParts) {
          entry.mapB.set(klasifikasi, (entry.mapB.get(klasifikasi) ?? 0) + share);
        }
      }
    }

    const frames = [...accountMap.entries()]
      .map(([accountCode, entry]) => {
        const allKlasifikasi = new Set<string>([
          ...entry.mapA.keys(),
          ...entry.mapB.keys(),
        ]);

        const detailRows = [...allKlasifikasi]
          .map((klasifikasi) => ({
            klasifikasi,
            prev: entry.mapB.get(klasifikasi) ?? 0,
            curr: entry.mapA.get(klasifikasi) ?? 0,
            delta: (entry.mapA.get(klasifikasi) ?? 0) - (entry.mapB.get(klasifikasi) ?? 0),
            reason: [...(entry.reasonMap.get(klasifikasi) ?? new Set<string>())].join('; '),
            reasons: [...(entry.reasonMap.get(klasifikasi) ?? new Set<string>())],
          }))
          .filter((row) => row.prev !== 0 || row.curr !== 0)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        // ─── TOP 5 untuk chart display ─────────────────────────────────
        const top5ClassificationRows = detailRows
          .slice(0, 5)
          .map((r) => ({ klasifikasi: r.klasifikasi, prev: r.prev, curr: r.curr }))
          .sort((a, b) => Math.max(Math.abs(b.prev), Math.abs(b.curr)) - Math.max(Math.abs(a.prev), Math.abs(a.curr)));

        return {
          accountCode,
          rows: top5ClassificationRows,
          detailRows,
          frameReason: summarizeAccountFrameReason(detailRows, compMode),
        };
      })
      .sort((a, b) => {
        // Sort by the order from frameAccountsMap, if available
        const aIdx = [...(frameAccountsMap[activeAccountTab] || [])].indexOf(a.accountCode);
        const bIdx = [...(frameAccountsMap[activeAccountTab] || [])].indexOf(b.accountCode);
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        // Fallback to hardcoded order
        return activeTabDef.accountCodes.indexOf(a.accountCode) - activeTabDef.accountCodes.indexOf(b.accountCode);
      });

    return { frames, labelA, labelB };
  }, [records, compMode, compPeriode, activeTabDef, frameAccountsMap, activeAccountTab]);

  const activeReasonFrame = useMemo(
    () => accountFramesByMode.frames.find((f) => f.accountCode === activeReasonAccountCode) ?? null,
    [accountFramesByMode.frames, activeReasonAccountCode],
  );

  const legendColors = useMemo(
    () => resolveDetailSeriesColors(accountFramesByMode.labelB || 'Basis', accountFramesByMode.labelA || 'Berjalan'),
    [accountFramesByMode.labelA, accountFramesByMode.labelB],
  );

  useEffect(() => {
    if (!activeReasonFrame) return;
    if (!reasonOverlayRef.current || !reasonPanelRef.current) return;

    gsap.fromTo(reasonOverlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power2.out' });
    gsap.fromTo(reasonPanelRef.current, { opacity: 0, y: 22, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'power3.out' });

    if (reasonListRef.current) {
      const items = Array.from(reasonListRef.current.querySelectorAll('.reason-item'));
      if (items.length > 0) {
        animate(items, {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: 220,
          delay: stagger(45),
          ease: 'easeOutQuad',
        });
      }
    }
  }, [activeReasonFrame]);

  useEffect(() => {
    if (!activeReasonFrame) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveReasonAccountCode(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [activeReasonFrame]);

  const allAkunCodes = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + Math.abs(r.amount)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [records]);

  const codeColorMap = useMemo(
    () => new Map(allAkunCodes.map((c, i) => [c, PALETTE[i % PALETTE.length]])),
    [allAkunCodes],
  );

  const allKlasifikasi = useMemo(() => {
    const s = new Set<string>();
    // Use pre-processed _parts — no split needed here
    records.forEach(r => r._parts.forEach(k => s.add(k)));
    return [...s].sort();
  }, [records]);

  const filteredAkunOptions = useMemo(() =>
    allAkunCodes.filter(c => {
      if (!c.toLowerCase().includes(searchAkun.toLowerCase())) return false;
      if (filterSubAkun.size > 0 && !filterSubAkun.has(subGroupForCode(c)?.label ?? '')) return false;
      return true;
    }),
  [allAkunCodes, searchAkun, filterSubAkun]);

  // Filtered by year+klasifikasi only — used for sub-akun totals so amounts
  // are always visible regardless of which sub-akun is selected
  const baseFiltered = useMemo(() => records.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterKlasifikasi.size > 0 && !r._parts.some(k => filterKlasifikasi.has(k))) return false;
    return true;
  }), [records, selectedYear, filterKlasifikasi]);

  const filtered = useMemo(() => records.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterSubAkun.size > 0 && !filterSubAkun.has(subGroupForCode(r.accountCode)?.label ?? '')) return false;
    if (filterAkun.size > 0 && !filterAkun.has(r.accountCode)) return false;
    // Use pre-cached _parts — no split on every filter pass
    if (filterKlasifikasi.size > 0 && !r._parts.some(k => filterKlasifikasi.has(k))) return false;
    return true;
  }), [records, selectedYear, filterSubAkun, filterAkun, filterKlasifikasi]);

  const totalFiltered = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const accountTotalsMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + r.amount));
    return m;
  }, [filtered]);

  const subAkunTotals = useMemo(() => {
    const m = new Map<string, number>();
    baseFiltered.forEach(r => {
      const lbl = subGroupForCode(r.accountCode)?.label;
      if (lbl) m.set(lbl, (m.get(lbl) ?? 0) + r.amount);
    });
    return m;
  }, [baseFiltered]);

  const topAccounts = useMemo(() => {
    const entries = [...accountTotalsMap.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const top14   = entries.slice(0, 14);
    const others  = entries.slice(14);
    const othersTotal = others.reduce((s, [, v]) => s + v, 0);
    const result = top14.map(([code, value]) => ({
      label: code,
      value,
      color: codeColorMap.get(code) ?? '#94a3b8',
    }));
    if (others.length > 0) result.push({ label: `+${others.length} lainnya`, value: othersTotal, color: '#cbd5e1' });
    return result.filter(d => d.value !== 0);
  }, [accountTotalsMap, codeColorMap]);

  const donutTotal = useMemo(() => topAccounts.reduce((s, d) => s + Math.abs(d.value), 0), [topAccounts]);

  const byPeriode = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.periode, (m.get(r.periode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
  }, [filtered]);

  const accountSummaryRows = useMemo(() => {
    return [...accountTotalsMap.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([code, total]) => ({ code, total, color: codeColorMap.get(code) ?? '#94a3b8' }));
  }, [accountTotalsMap, codeColorMap]);

  const klasifikasiTotalsMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const { _parts, amount } = r;
      const share = amount / _parts.length;
      const active = filterKlasifikasi.size > 0 ? _parts.filter(k => filterKlasifikasi.has(k)) : _parts;
      active.forEach(k => m.set(k, (m.get(k) ?? 0) + share));
    });
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  }, [filtered, filterKlasifikasi]);

  const klasifikasiLookup = useMemo(
    () => new Map(klasifikasiTotalsMap.map(d => [d.label, d])),
    [klasifikasiTotalsMap],
  );

  const listingRows = useMemo(() => {
    type Row = { accountCode: string; klasifikasiParts: Set<string>; total: number; periodes: number };
    const m = new Map<string, Row>();
    filtered.forEach(({ accountCode, amount, _parts }) => {
      let ex = m.get(accountCode);
      if (!ex) { ex = { accountCode, klasifikasiParts: new Set(), total: 0, periodes: 0 }; m.set(accountCode, ex); }
      _parts.forEach(p => ex!.klasifikasiParts.add(p));
      ex.total += amount;
      ex.periodes++;
    });
    return [...m.values()]
      .map(row => ({ ...row, klasifikasi: [...row.klasifikasiParts].join('; ') }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered]);

  const listingTotalPages = useMemo(
    () => Math.ceil(listingRows.length / LIST_PAGE_SIZE),
    [listingRows],
  );
  const listingPage = useMemo(
    () => listingRows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE),
    [listingRows, listPage],
  );

  const latestPeriode = useMemo(() => {
    // Single-pass max instead of sort()
    let max = '';
    records.forEach(r => { if (r.periode > max) max = r.periode; });
    return max ? periodeToLabel(max) : '-';
  }, [records]);

  const resetFilters = useCallback(() => {
    if (resetBtnRef.current) {
      animate(resetBtnRef.current, {
        translateX: [0, -6, 6, -4, 4, 0],
        duration: 380,
        ease: 'easeInOutSine',
      });
    }
    setSelectedYear('all');
    setSearchAkunRaw('');
    setFilterAkun(new Set());
    setFilterSubAkun(new Set());
    setFilterKlasifikasi(new Set());
    setListPage(0);
  }, []);

  const toggleSubAkun = useCallback((lbl: string) => setFilterSubAkun(prev => {
    const n = new Set(prev); n.has(lbl) ? n.delete(lbl) : n.add(lbl); return n;
  }), []);

  const toggleAkun = useCallback((code: string) => setFilterAkun(prev => {
    const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n;
  }), []);

  const toggleKlasifikasi = useCallback((k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  }), []);

  // Animated total counter
  const counterRef = useAnimatedCounter(totalFiltered, [totalFiltered]);

  // ── Shell ────────────────────────────────────────────────────────────────
  const shell = (content: React.ReactNode) => (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-100">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">
        <Header
          title="Dashboard Per Akun Fluktuasi"
          subtitle={`per ${latestPeriode}`}
          onMenuClick={() => setMobileSidebar(true)}
        />
        {content}
      </div>
    </div>
  );

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) return shell(<PageSkeleton />);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (records.length === 0) return shell(
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="max-w-sm w-full text-center shadow-lg border-0 bg-white/80 backdrop-blur">
        <CardContent className="pt-8 pb-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <BarChart3 className="w-8 h-8 text-blue-400" />
          </div>
          <p className="text-slate-700 font-semibold text-base">Belum ada data fluktuasi</p>
          <p className="text-slate-400 text-sm mt-1">
            Upload data di halaman <strong className="text-blue-600">Fluktuasi OI/EXP</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────
  return shell(
    <div className="flex-1 overflow-y-auto">

      <div className="px-3 sm:px-4 pt-3 pb-1">
        <Card className="border border-blue-100/80 bg-white/90 backdrop-blur shadow-sm">
          <CardHeader ref={pillsRef} className="p-2 pb-1 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <CardTitle className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                Dashboard Detail Per Akun
              </CardTitle>
              <Badge variant="outline" className="h-5 text-[9px] border-blue-200 text-blue-700 bg-blue-50">
                {records.length.toLocaleString('id-ID')} records
              </Badge>
              <Badge variant="outline" className="h-5 text-[9px] border-emerald-200 text-emerald-700 bg-emerald-50">
                {accountFramesByMode.labelB || '-'} vs {accountFramesByMode.labelA || '-'}
              </Badge>
              <div className="ml-auto flex gap-1">
                {(['mom', 'yoy', 'ytd'] as const).map(mode => (
                  <Button
                    key={mode}
                    onClick={() => setCompMode(mode)}
                    size="sm"
                    variant={compMode === mode ? 'default' : 'outline'}
                    className={`h-6 px-2 text-[9px] font-bold uppercase ${compMode === mode ? 'bg-red-500 hover:bg-red-500 text-white border-red-500' : 'text-slate-600 border-blue-200 hover:bg-blue-50'}`}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[9px]">
              <span className="text-slate-500 font-semibold uppercase">Periode:</span>
              <select
                value={compPeriode}
                onChange={e => setCompPeriodeRaw(e.target.value)}
                className="text-[9px] font-mono font-semibold border border-blue-200 rounded px-1.5 py-0.5 bg-[#f8fbff] text-slate-700 focus:outline-none focus:border-blue-400"
              >
                {allPeriodes.map(p => (
                  <option key={p} value={p}>{periodeToLabel(p)}</option>
                ))}
              </select>
              <span className="text-slate-500 w-full sm:w-auto sm:ml-auto">
                Basis: <strong className="text-slate-600">{accountFramesByMode.labelB || '-'}</strong> vs <strong className="text-slate-600">{accountFramesByMode.labelA || '-'}</strong>
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {ACCOUNT_TAB_DEFS.map(tab => (
                <Button
                  key={tab.key}
                  onClick={() => setActiveAccountTab(tab.key)}
                  size="sm"
                  variant={activeAccountTab === tab.key ? 'default' : 'outline'}
                  className={`h-7 px-2.5 text-[10px] font-bold ${activeAccountTab === tab.key ? 'bg-red-500 hover:bg-red-500 text-white border-red-500' : 'text-red-600 border-red-200 hover:bg-red-50'}`}
                >
                  {tab.title}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="p-2 pt-1">
            {accountFramesByMode.frames.length === 0 ? (
              <Card className="border border-slate-200 shadow-sm bg-white">
                <CardContent className="p-6">
                  <p className="text-xs text-slate-400 text-center py-10">Tidak ada data akun pada periode ini</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="mb-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-700">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: legendColors.prev }} />
                    <span>{accountFramesByMode.labelB || 'Basis'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: legendColors.curr }} />
                    <span>{accountFramesByMode.labelA || 'Berjalan'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {accountFramesByMode.frames.map((frame) => (
                    <Card key={frame.accountCode} className="border border-slate-200 shadow-sm bg-white">
                    <CardHeader className="p-2 pb-1">
                      <CardTitle className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-red-600">
                        {(ACCOUNT_NAMES[frame.accountCode] ?? frame.accountCode) + ` (${frame.accountCode})`}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 pt-0">
                      {frame.rows.length === 0 ? (
                        <p className="text-[11px] text-slate-400 text-center py-10">Tidak ada data untuk kode akun ini pada periode pembanding.</p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <div className="h-[280px] sm:h-[250px] w-full">
                            <ChartBar
                              data={buildDetailChartData(
                                frame.rows,
                                accountFramesByMode.labelB || 'Basis',
                                accountFramesByMode.labelA || 'Berjalan',
                              )}
                              options={buildDetailChartOptions(
                                isCompact,
                                accountFramesByMode.labelB || 'Basis',
                                accountFramesByMode.labelA || 'Berjalan',
                              )}
                            />
                          </div>

                          <div className="rounded-md border border-blue-100 bg-[#f8fbff] px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Reason Singkat</p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-5 px-1.5 text-[9px] border-blue-200 text-blue-700 hover:bg-blue-50"
                                onClick={() => setActiveReasonAccountCode(frame.accountCode)}
                              >
                                Reason Lengkap
                              </Button>
                            </div>
                            <p className="text-[10px] leading-4 text-slate-700 max-h-16 overflow-y-auto pr-1 whitespace-normal break-words">
                              {frame.frameReason || '-'}
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="pb-4" />

      {activeReasonFrame && (
        <div
          ref={reasonOverlayRef}
          className="fixed inset-0 z-[70] bg-slate-900/35 backdrop-blur-[1px] px-3 py-5 sm:p-6 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveReasonAccountCode(null);
          }}
        >
          <Card ref={reasonPanelRef} className="w-full max-w-3xl border border-blue-100 shadow-2xl bg-white">
            <CardHeader className="p-3 pb-2 border-b border-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wide text-slate-800">
                    Reason Lengkap - {(ACCOUNT_NAMES[activeReasonFrame.accountCode] ?? activeReasonFrame.accountCode)} ({activeReasonFrame.accountCode})
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {compMode.toUpperCase()} • {accountFramesByMode.labelB || 'Basis'} vs {accountFramesByMode.labelA || 'Berjalan'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setActiveReasonAccountCode(null)}>
                  Tutup
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-2 space-y-2">
              <div className="rounded-md border border-blue-100 bg-[#f8fbff] px-2 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-1">Ringkasan</p>
                <p className="text-[11px] leading-5 text-slate-700">{activeReasonFrame.frameReason || '-'}</p>
              </div>

              <ScrollArea className="h-[46vh] rounded-md border border-slate-200 bg-white">
                <div ref={reasonListRef} className="p-2.5 space-y-2">
                  {activeReasonFrame.detailRows.length === 0 ? (
                    <p className="text-xs text-slate-500">Tidak ada detail klasifikasi movement pada akun ini.</p>
                  ) : (
                    activeReasonFrame.detailRows
                      .filter((row) => row.delta !== 0)
                      .map((row) => (
                        <div key={`${activeReasonFrame.accountCode}::${row.klasifikasi}`} className="reason-item rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-800">{row.klasifikasi}</p>
                            <Badge
                              variant="outline"
                              className={`h-5 text-[10px] ${row.delta >= 0 ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-rose-200 text-rose-700 bg-rose-50'}`}
                            >
                              {row.delta >= 0 ? 'Naik' : 'Turun'} {fmtCompact(Math.abs(row.delta))}
                            </Badge>
                            <span className="text-[10px] text-slate-500">{fmtCompact(row.prev)} {'->'} {fmtCompact(row.curr)}</span>
                          </div>
                          <p className="mt-1 text-[11px] leading-5 text-slate-600 whitespace-pre-wrap break-words">
                            {row.reason || 'Tidak ada narasi reason pada klasifikasi ini.'}
                          </p>
                        </div>
                      ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
