'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import dynamic from 'next/dynamic';
import { Activity, TrendingUp } from 'lucide-react';
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
import { Skeleton } from '../components/ui/skeleton';
import { ScrollArea } from '../components/ui/scroll-area';

const Sidebar  = dynamic(() => import('../components/Sidebar'),  { ssr: false });
const Header   = dynamic(() => import('../components/Header'),   { ssr: false });

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend, ChartDataLabels);

/* ─── Loading Skeleton ──────────────────────────────────────────────────────── */
function PageSkeleton({ isMobileSidebarOpen, setMobileSidebar }: { isMobileSidebarOpen: boolean; setMobileSidebar: (v: boolean) => void }) {
  const skeletonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!skeletonRef.current) return;
    const cards = skeletonRef.current.querySelectorAll('.sk-card');
    gsap.fromTo(cards, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, ease: 'power3.out' });
  }, []);
  return (
    <div className="flex h-screen bg-[#f0f4fa] overflow-hidden">
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col">
        <Header title="Overview Fluktuasi OI/EXP" subtitle="Memuat data…" onMenuClick={() => setMobileSidebar(true)} />
        <div ref={skeletonRef} className="flex-1 overflow-hidden p-2 space-y-2">
          <Card className="sk-card shadow-sm border border-blue-100 bg-[#eef5ff]">
            <div className="p-3 pb-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-44" />
                <div className="ml-auto flex gap-1">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-5 w-10 rounded" />)}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-24 rounded" />
                <Skeleton className="ml-auto h-3 w-44" />
              </div>
            </div>

            <div className="px-3 pb-2">
              <div className="mb-2 flex items-center justify-end gap-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-20" />
              </div>

              <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
                {[...Array(4)].map((_, i) => (
                  <Card key={i} className="border border-slate-200 shadow-sm bg-white">
                    <div className="p-3 pb-1">
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <div className="p-2.5 pt-1.5 space-y-1.5">
                      <Skeleton className="h-[120px] w-full rounded-md" />
                      <div className="rounded-md border border-blue-100 bg-[#f8fbff] px-2 py-1">
                        <Skeleton className="h-3 w-20 mb-1" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
      {/* Centered spinner overlay */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-20">
        <div className="bg-white/90 backdrop-blur-sm border border-blue-200/60 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
            <div className="absolute inset-0 rounded-full border-4 border-t-blue-600 border-r-blue-300 border-b-transparent border-l-transparent animate-spin" />
            <Activity className="absolute inset-0 m-auto w-6 h-6 text-blue-600" />
          </div>
          <p className="text-slate-700 text-sm font-semibold tracking-wide">Memuat data fluktuasi...</p>
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type AkunPeriodeRecord = {
  id?: number;
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi?: string;
  reasonMoM?: string;
  reasonYoY?: string;
  reasonYtD?: string;
};

type ParsedRecord = {
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi: string;
  reasonMoM: string;
  reasonYoY: string;
  reasonYtD: string;
};

type RekapReasonRecord = {
  accountCode: string;
  periode: string;
  reasonMoM?: string;
  reasonYoY?: string;
  reasonYtD?: string;
};

type RekapGroupResponse = {
  success?: boolean;
  data?: {
    rekapSheetData?: {
      rows?: Array<{
        type?: string;
        values?: unknown[];
      }>;
    } | null;
  };
};

type FrameReasonRow = {
  klasifikasi: string;
  prev: number;
  curr: number;
  delta: number;
  reason: string;
  reasons: string[];
  contributors: {
    accountCode: string;
    accountName: string;
    prev: number;
    curr: number;
    delta: number;
  }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const fmtCompact = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(1).replace('.',',') + ' M';
  if (a >= 1_000_000)     return sign + Math.round(a / 1_000_000).toLocaleString('id-ID') + ' JT';
  if (a >= 1_000)         return sign + Math.round(a / 1_000).toLocaleString('id-ID') + ' RB';
  return sign + Math.round(a).toLocaleString('id-ID');
};

const periodeToLabel = (p: string): string => {
  const [yr, mo] = p.split('.');
  const m = parseInt(mo) - 1;
  return `${MONTHS_ID[m] ?? mo} ${yr}`;
};

const compactReason = (reason: string, maxLen = 80): string => {
  const base = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!base) return '-';
  const firstPoint = base.split(';').map(s => s.trim()).find(Boolean) ?? base;
  if (firstPoint.length <= maxLen) return firstPoint;
  return `${firstPoint.slice(0, maxLen - 1)}...`;
};

const autoReasonFromContributors = (row: FrameReasonRow): string => {
  const movers = row.contributors.filter((c) => c.delta !== 0).slice(0, 5);
  if (movers.length === 0) return 'Tidak ada narasi reason pada klasifikasi ini.';
  const dir = row.delta >= 0 ? 'Kenaikan' : 'Penurunan';
  const parts = movers.map((c) => `${c.accountName} ${fmtCompact(Math.abs(c.delta))}`);
  return `${dir} dipengaruhi oleh: ${parts.join('; ')}.`;
};

const SUBTOTAL_DELTA_EPSILON = 1;

const parseOverviewKlasifikasiParts = (raw: string, accountCode: string): string[] => {
  const parts = String(raw || '').split(';').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  // Untuk frame selisih kurs (akun 716*), hanya klasifikasi bertema kurs yang dipakai.
  if (accountCode.startsWith('716')) {
    return parts.filter((p) => /selisih\s*kurs|kurs/i.test(p));
  }

  return [...new Set(parts)];
};

const isKlasifikasiAllowedInFrame = (frameKey: FrameKey, klasifikasi: string): boolean => {
  const k = String(klasifikasi || '').trim().toLowerCase();
  if (!k) return false;

  // Rule bisnis: Kor. Tagihan Air hanya valid pada kelompok Pendapatan Lain-Lain.
  if (/^kor\.?\s*tagihan\s*air$/.test(k) && frameKey !== 'pendapatan-lain') {
    return false;
  }

  return true;
};

const summarizeFrameReason = (
  rows: FrameReasonRow[],
  frameTitle: string,
  mode: 'mom' | 'yoy' | 'ytd',
  labelA: string,
  labelB: string,
): string => {
  if (rows.length === 0) return '-';

  const movers = rows.map((row) => ({ ...row, delta: row.curr - row.prev }));
  const nonZero = movers.filter((m) => m.delta !== 0);
  if (nonZero.length === 0) {
    return `Tidak ada perubahan ${mode.toUpperCase()} yang signifikan pada frame ini.`;
  }

  const topNaik = nonZero
    .filter((m) => m.delta > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const topTurun = nonZero
    .filter((m) => m.delta < 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const netDelta = nonZero.reduce((s, m) => s + m.delta, 0);
  const netDir = netDelta >= 0 ? 'naik' : 'turun';

  let summary = `${mode.toUpperCase()}: ${frameTitle} ${netDir} ${fmtCompact(Math.abs(netDelta))}.`;

  if (topNaik) {
    summary += ` Naik terbesar: ${topNaik.klasifikasi} ${fmtCompact(Math.abs(topNaik.delta))}.`;
  }
  if (topTurun) {
    summary += ` Turun terbesar: ${topTurun.klasifikasi} ${fmtCompact(Math.abs(topTurun.delta))}.`;
  }

  return summary;
};

const EXCLUDED_OVERVIEW_ACCOUNT_CODES = new Set([
  '71510000', // BEBAN BUNGA PINJAMAN
  '71400000', // PENDAPATAN KLAIM
  '71560000', // BEBAN LAIN-LAIN
  '71300000', // PENDAPATAN BUNGA
  '71600000', // LABA (RUGI) SELISIH KURS
]);

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
  '71560000': 'BEBAN LAIN-LAIN',
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

type FrameDef = {
  key: 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';
  title: string;
  accounts: string[];
  match: (accountCode: string) => boolean;
};

type FrameKey = FrameDef['key'];

const EMPTY_FRAME_ACCOUNT_MAP: Record<FrameKey, Set<string>> = {
  'beban-bunga': new Set<string>(),
  'pendapatan-lain': new Set<string>(),
  'pendapatan-bunga': new Set<string>(),
  'selisih-kurs': new Set<string>(),
};

const parseFrameKeyFromCategory = (raw: string): FrameKey | null => {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.includes('beban bunga')) return 'beban-bunga';
  if (s.includes('pendapatan lain')) return 'pendapatan-lain';
  if (s.includes('pendapatan bunga')) return 'pendapatan-bunga';
  if (s.includes('selisih kurs')) return 'selisih-kurs';
  return null;
};

const buildFrameAccountsFromRekap = (resp: RekapGroupResponse | null | undefined): Record<FrameKey, Set<string>> => {
  const out: Record<FrameKey, Set<string>> = {
    'beban-bunga': new Set<string>(),
    'pendapatan-lain': new Set<string>(),
    'pendapatan-bunga': new Set<string>(),
    'selisih-kurs': new Set<string>(),
  };

  const rows = resp?.data?.rekapSheetData?.rows;
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
    if (EXCLUDED_OVERVIEW_ACCOUNT_CODES.has(accountCode)) continue;

    out[currentFrame].add(accountCode);
  }

  return out;
};

const FRAME_DEFS: FrameDef[] = [
  {
    key: 'beban-bunga',
    title: 'Beban Bunga',
    accounts: ['71510001','71510002','71510003','71510004','71510005','71510098','71510099'],
    match: (accountCode: string) => accountCode.startsWith('7151'),
  },
  {
    key: 'pendapatan-lain',
    title: 'Pendapatan Lain-Lain',
    accounts: ['71410001','71410009','71421001','71421002','71421009','71430001','71430002','71440001','71460001','71460002','71460009','71560001'],
    match: (accountCode: string) => accountCode.startsWith('714') || accountCode.startsWith('7156'),
  },
  {
    key: 'pendapatan-bunga',
    title: 'Pendapatan Bunga',
    accounts: ['71310001','71310002','71320001','71320002'],
    match: (accountCode: string) => accountCode.startsWith('713'),
  },
  {
    key: 'selisih-kurs',
    title: 'Laba (Rugi) Selisih Kurs',
    accounts: ['71610001','71610002','71620001','71620002','71620004'],
    match: (accountCode: string) => accountCode.startsWith('716'),
  },
];

const TOP_CLASSIFICATIONS_PER_FRAME = 5;

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

const resolveOverviewSeriesColors = (labelPrev: string, labelCurr: string): SeriesColors => {
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

  // Jika tahun sama (mis. MOM Jan 2026 vs Feb 2026), pakai palet role-based
  // agar dua seri tetap mudah dibedakan.
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

const buildOverviewChartData = (
  rows: { klasifikasi: string; prev: number; curr: number }[],
  labelPrev: string,
  labelCurr: string,
): ChartData<'bar'> => {
  const colors = resolveOverviewSeriesColors(labelPrev, labelCurr);
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

const buildOverviewChartOptions = (isCompact: boolean, labelPrev: string, labelCurr: string): ChartOptions<'bar'> => ({
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
        if (v === 0) return 'center';
        // Untuk batang negatif, anchor ke sisi baseline (nol).
        return v < 0 ? 'start' : 'end';
      },
      align: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        // Nilai nol ditaruh di bawah baseline agar tidak ter-clip di atas area chart.
        if (v === 0) return 'bottom';
        // Nilai negatif ditempatkan sedikit ke dalam batang dari baseline agar tidak terpotong.
        return v < 0 ? 'bottom' : 'end';
      },
      offset: (ctx: any) => {
        const v = Number(ctx.dataset?.data?.[ctx.dataIndex] ?? 0);
        if (v === 0) return 2;
        return v < 0 ? 2 : 2;
      },
      clamp: true,
      clip: false,
      font: {
        size: 9,
        weight: 700,
      },
      color: (ctx: any) => {
        const c = resolveOverviewSeriesColors(labelPrev, labelCurr);
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

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OverviewFluktuasiPage() {
  const [records, setRecords]                   = useState<ParsedRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);
  const [isCompact, setIsCompact]               = useState(false);
  const [frameAccountsFromRekap, setFrameAccountsFromRekap] = useState<Record<FrameKey, Set<string>>>(EMPTY_FRAME_ACCOUNT_MAP);
  const [activeReasonFrameKey, setActiveReasonFrameKey] = useState<FrameDef['key'] | null>(null);
  const [expandedReasonRows, setExpandedReasonRows] = useState<Set<string>>(new Set());

  const [compMode,       setCompMode]       = useState<'mom' | 'yoy' | 'ytd'>('yoy');
  const [compPeriodeRaw, setCompPeriodeRaw] = useState<string>('');

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    // Basis klasifikasi dari tabel akun-periode + reason dari rekap-amounts.
    Promise.all([
      fetch('/api/fluktuasi/akun-periodes?slim=1').then((r) => r.json()),
      fetch('/api/fluktuasi/rekap-amounts')
        .then((r) => r.json())
        .catch(() => ({ success: false, data: [] as RekapReasonRecord[] })),
      fetch('/api/fluktuasi')
        .then((r) => r.json())
        .catch(() => ({ success: false, data: { rekapSheetData: null } } as RekapGroupResponse)),
    ])
      .then(([akunData, rekapData, rekapGroupData]: [
        { success: boolean; data: AkunPeriodeRecord[] },
        { success: boolean; data: RekapReasonRecord[] },
        RekapGroupResponse,
      ]) => {
        const groupedAccounts = buildFrameAccountsFromRekap(rekapGroupData);
        setFrameAccountsFromRekap(groupedAccounts);

        if (akunData.success && Array.isArray(akunData.data)) {
          const reasonMap = new Map<string, { reasonMoM: string; reasonYoY: string; reasonYtD: string }>();
          if (rekapData?.success && Array.isArray(rekapData.data)) {
            for (const rr of rekapData.data) {
              reasonMap.set(`${rr.accountCode}|${rr.periode}`, {
                reasonMoM: String(rr.reasonMoM ?? ''),
                reasonYoY: String(rr.reasonYoY ?? ''),
                reasonYtD: String(rr.reasonYtD ?? ''),
              });
            }
          }

          setRecords(akunData.data.map(r => {
            const mergedReason = reasonMap.get(`${r.accountCode}|${r.periode}`);
            return {
              accountCode: r.accountCode,
              periode:     r.periode,
              amount:      r.amount,
              klasifikasi: String(r.klasifikasi ?? '').trim(),
              reasonMoM:   String(mergedReason?.reasonMoM ?? r.reasonMoM ?? ''),
              reasonYoY:   String(mergedReason?.reasonYoY ?? r.reasonYoY ?? ''),
              reasonYtD:   String(mergedReason?.reasonYtD ?? r.reasonYtD ?? ''),
            };
          }));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
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

  const allPeriodes = useMemo(() => {
    const periodeSet = new Set<string>();
    for (const r of records) periodeSet.add(r.periode);
    return [...periodeSet].sort();
  }, [records]);

  const compPeriode = compPeriodeRaw || (allPeriodes.length > 0 ? allPeriodes[allPeriodes.length - 1] : '');

  const accountFramesByMode = useMemo(() => {
    if (!compPeriode) {
      return {
        frames: FRAME_DEFS.map(frame => ({
          key: frame.key,
          title: frame.title,
          rows: [] as FrameReasonRow[],
          detailRows: [] as FrameReasonRow[],
          frameReason: '-',
        })),
        labelA: '',
        labelB: '',
        tagA: 'A',
        tagB: 'B',
      };
    }

    const [yearStr, monStr] = compPeriode.split('.');
    const yearA = parseInt(yearStr);
    const monA = parseInt(monStr);

    let periodesA: Set<string>;
    let periodesB: Set<string>;
    let labelA: string;
    let labelB: string;
    let tagA: string;
    let tagB: string;

    if (compMode === 'mom') {
      const prevMon = monA === 1 ? 12 : monA - 1;
      const prevYear = monA === 1 ? yearA - 1 : yearA;
      const periodeB = `${prevYear}.${String(prevMon).padStart(2, '0')}`;
      periodesA = new Set([compPeriode]);
      periodesB = new Set([periodeB]);
      labelA = periodeToLabel(compPeriode);
      labelB = periodeToLabel(periodeB);
      tagA = MONTHS_ID[monA - 1];
      tagB = MONTHS_ID[prevMon - 1];
    } else if (compMode === 'yoy') {
      const periodeB = `${yearA - 1}.${monStr}`;
      periodesA = new Set([compPeriode]);
      periodesB = new Set([periodeB]);
      labelA = periodeToLabel(compPeriode);
      labelB = periodeToLabel(periodeB);
      tagA = String(yearA).slice(-2);
      tagB = String(yearA - 1).slice(-2);
    } else {
      periodesA = new Set<string>();
      periodesB = new Set<string>();
      for (let m = 1; m <= monA; m++) {
        periodesA.add(`${yearA}.${String(m).padStart(2, '0')}`);
        periodesB.add(`${yearA - 1}.${String(m).padStart(2, '0')}`);
      }
      labelA = `YTD ${yearA}`;
      labelB = `YTD ${yearA - 1}`;
      tagA = String(yearA).slice(-2);
      tagB = String(yearA - 1).slice(-2);
    }

    const frameAccountsResolved = FRAME_DEFS.map((frame) => {
      const fromRekap = frameAccountsFromRekap[frame.key];
      const accounts = (fromRekap && fromRekap.size > 0) ? [...fromRekap] : frame.accounts;
      return { key: frame.key, accounts: new Set(accounts) };
    });

    const accountToFrame = new Map<string, FrameKey>();
    for (const entry of frameAccountsResolved) {
      for (const accountCode of entry.accounts) {
        accountToFrame.set(accountCode, entry.key);
      }
    }

    const frameMaps = FRAME_DEFS.map(frame => ({
      ...frame,
      mapA: new Map<string, number>(),
      mapB: new Map<string, number>(),
      reasons: new Map<string, Set<string>>(),
      contributorMaps: new Map<string, Map<string, { prev: number; curr: number }>>(),
    }));

    const frameByKey = new Map(frameMaps.map((f) => [f.key, f]));

    // Pass-1: tentukan frame dominan untuk tiap klasifikasi pada window komparasi aktif.
    const klasifikasiFrameTotals = new Map<string, Map<FrameKey, number>>();
    for (const r of records) {
      if (EXCLUDED_OVERVIEW_ACCOUNT_CODES.has(r.accountCode)) continue;
      const frameKey = accountToFrame.get(r.accountCode);
      if (!frameKey) continue;
      if (!periodesA.has(r.periode) && !periodesB.has(r.periode)) continue;

      const parts = parseOverviewKlasifikasiParts(String(r.klasifikasi || ''), r.accountCode)
        .filter((k) => isKlasifikasiAllowedInFrame(frameKey, k));
      if (parts.length === 0) continue;

      const shareAbs = Math.abs(r.amount / parts.length);
      for (const klasifikasi of parts) {
        const m = klasifikasiFrameTotals.get(klasifikasi) ?? new Map<FrameKey, number>();
        m.set(frameKey, (m.get(frameKey) ?? 0) + shareAbs);
        klasifikasiFrameTotals.set(klasifikasi, m);
      }
    }

    const dominantFrameByKlasifikasi = new Map<string, FrameKey>();
    for (const [klasifikasi, totals] of klasifikasiFrameTotals.entries()) {
      const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) dominantFrameByKlasifikasi.set(klasifikasi, best[0]);
    }

    for (const r of records) {
      if (EXCLUDED_OVERVIEW_ACCOUNT_CODES.has(r.accountCode)) continue;
      const frameKey = accountToFrame.get(r.accountCode);
      if (!frameKey) continue;
      const frame = frameByKey.get(frameKey);
      if (!frame) continue;

      const klasifikasiParts = parseOverviewKlasifikasiParts(String(r.klasifikasi || ''), r.accountCode);
      const filteredParts = klasifikasiParts.filter((k) => {
        if (!isKlasifikasiAllowedInFrame(frame.key, k)) return false;
        const dominant = dominantFrameByKlasifikasi.get(k);
        return !dominant || dominant === frame.key;
      });
      if (filteredParts.length === 0) continue;
      const share = r.amount / filteredParts.length;

      const reasonRaw = compMode === 'mom' ? r.reasonMoM : compMode === 'yoy' ? r.reasonYoY : r.reasonYtD;
      const reasonList = String(reasonRaw || '').split(';').map(s => s.trim()).filter(Boolean);
      for (const klasifikasi of filteredParts) {
        if (reasonList.length > 0) {
          const set = frame.reasons.get(klasifikasi) ?? new Set<string>();
          for (const reason of reasonList) set.add(reason);
          frame.reasons.set(klasifikasi, set);
        }

        if (periodesA.has(r.periode)) {
          frame.mapA.set(klasifikasi, (frame.mapA.get(klasifikasi) ?? 0) + share);

          const byAcc = frame.contributorMaps.get(klasifikasi) ?? new Map<string, { prev: number; curr: number }>();
          const currAcc = byAcc.get(r.accountCode) ?? { prev: 0, curr: 0 };
          currAcc.curr += share;
          byAcc.set(r.accountCode, currAcc);
          frame.contributorMaps.set(klasifikasi, byAcc);
        } else if (periodesB.has(r.periode)) {
          frame.mapB.set(klasifikasi, (frame.mapB.get(klasifikasi) ?? 0) + share);

          const byAcc = frame.contributorMaps.get(klasifikasi) ?? new Map<string, { prev: number; curr: number }>();
          const currAcc = byAcc.get(r.accountCode) ?? { prev: 0, curr: 0 };
          currAcc.prev += share;
          byAcc.set(r.accountCode, currAcc);
          frame.contributorMaps.set(klasifikasi, byAcc);
        }
      }
    }

    const frames = frameMaps.map(frame => {
      const klasifikasiMap = new Map<string, { prev: number; curr: number; reasons: Set<string> }>();
      const allKlasifikasi = new Set<string>([
        ...frame.mapA.keys(),
        ...frame.mapB.keys(),
      ]);

      for (const klasifikasi of allKlasifikasi) {
        const prev = frame.mapB.get(klasifikasi) ?? 0;
        const curr = frame.mapA.get(klasifikasi) ?? 0;
        const reasonSet = frame.reasons.get(klasifikasi) ?? new Set<string>();

        const existing = klasifikasiMap.get(klasifikasi) ?? { prev: 0, curr: 0, reasons: new Set<string>() };
        existing.prev += prev;
        existing.curr += curr;
        for (const reason of reasonSet) existing.reasons.add(reason);
        klasifikasiMap.set(klasifikasi, existing);
      }

      const detailRows = [...klasifikasiMap.entries()]
        .map(([klasifikasi, v]) => ({
          contributors: [...(frame.contributorMaps.get(klasifikasi)?.entries() ?? [])]
            .map(([accountCode, av]) => ({
              accountCode,
              accountName: ACCOUNT_NAMES[accountCode] ?? accountCode,
              prev: av.prev,
              curr: av.curr,
              delta: av.curr - av.prev,
            }))
            .filter((c) => c.prev !== 0 || c.curr !== 0)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
          klasifikasi,
          prev: v.prev,
          curr: v.curr,
          delta: v.curr - v.prev,
          reason: [...v.reasons].join('; '),
          reasons: [...v.reasons],
        }))
        .filter(row => row.prev !== 0 || row.curr !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      const rows = [...detailRows]
        .slice(0, TOP_CLASSIFICATIONS_PER_FRAME);

      return {
        key: frame.key,
        title: frame.title,
        rows,
        detailRows,
        frameReason: summarizeFrameReason(detailRows, frame.title, compMode, labelA, labelB),
      };
    });

    return { frames, labelA, labelB, tagA, tagB };
  }, [records, compMode, compPeriode, frameAccountsFromRekap]);

  const legendColors = useMemo(
    () => resolveOverviewSeriesColors(accountFramesByMode.labelB || accountFramesByMode.tagB, accountFramesByMode.labelA || accountFramesByMode.tagA),
    [accountFramesByMode.labelA, accountFramesByMode.labelB, accountFramesByMode.tagA, accountFramesByMode.tagB],
  );

  const activeReasonFrame = useMemo(
    () => accountFramesByMode.frames.find((f) => f.key === activeReasonFrameKey) ?? null,
    [accountFramesByMode.frames, activeReasonFrameKey],
  );

  const toggleReasonRow = useCallback((rowKey: string) => {
    setExpandedReasonRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const reasonOverlayRef = useRef<HTMLDivElement>(null);
  const reasonPanelRef = useRef<HTMLDivElement>(null);
  const reasonListRef = useRef<HTMLDivElement>(null);

  // ── Refs for GSAP page animations ─────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Page-enter GSAP animations (runs whenever data loads)
  useEffect(() => {
    if (loading || records.length === 0) return;
    if (!contentRef.current) return;
    const cards = contentRef.current.querySelectorAll('.anim-card');
    gsap.fromTo(cards,
      { opacity: 0, y: 18, scale: 0.985 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out' }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, loading]);

  useEffect(() => {
    if (!controlsRef.current) return;
    const chips = Array.from(controlsRef.current.querySelectorAll('.overview-chip'));
    if (!chips.length) return;
    animate(chips, {
      opacity: [0, 1],
      translateY: [6, 0],
      duration: 260,
      delay: stagger(36),
      ease: 'easeOutQuad',
    });
  }, [compMode, compPeriode]);

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
      if (e.key === 'Escape') setActiveReasonFrameKey(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [activeReasonFrame]);

  useEffect(() => {
    if (!activeReasonFrame) {
      setExpandedReasonRows(new Set());
    }
  }, [activeReasonFrame]);

  useEffect(() => {
    if (!reasonListRef.current) return;
    const items = Array.from(reasonListRef.current.querySelectorAll('.contrib-item'));
    if (items.length === 0) return;
    animate(items, {
      opacity: [0, 1],
      translateY: [6, 0],
      duration: 180,
      delay: stagger(28),
      ease: 'easeOutQuad',
    });
  }, [expandedReasonRows]);

  // Table rows: simple CSS fade (no JS stagger on filter change — too expensive)
  // The initial page-entry GSAP timeline already handles first-render animation.

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton isMobileSidebarOpen={isMobileSidebarOpen} setMobileSidebar={setMobileSidebar} />;

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (records.length === 0) return (
    <div className="flex h-screen bg-[#f0f4fa] overflow-hidden">
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col">
        <Header title="Overview Fluktuasi OI/EXP" subtitle="Dashboard ringkasan data fluktuasi" onMenuClick={() => setMobileSidebar(true)} />
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="p-10 text-center space-y-4 shadow-lg">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center mx-auto shadow-inner">
              <TrendingUp size={36} className="text-blue-600" />
            </div>
            <p className="text-xl font-bold text-slate-800">Belum ada data fluktuasi</p>
            <p className="text-sm text-slate-500">Upload file Excel di halaman <strong className="text-blue-600">Fluktuasi OI/EXP</strong> terlebih dahulu</p>
          </Card>
        </div>
      </div>
    </div>
  );

  // ── Full Dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#f0f4fa] overflow-hidden">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">

        {/* Header */}
        <Header
          title="Overview Fluktuasi OI/EXP"
          subtitle={`Mode ${compMode.toUpperCase()} · ${records.length.toLocaleString('id-ID')} records`}
          onMenuClick={() => setMobileSidebar(true)}
        />

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-hidden p-1.5 sm:p-2 space-y-2 bg-gradient-to-b from-slate-50 to-[#edf3ff]">

          {/* 4 Frames: masing-masing 1 histogram gabungan */}
          <Card className="shadow-sm border border-blue-100/80 bg-white/90 backdrop-blur h-full flex flex-col">
            <CardHeader className="p-2 pb-1 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <CardTitle className="text-[10px] sm:text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <Activity size={12} className="text-rose-500" /> OVERVIEW 4 FRAME KODE AKUN
                </CardTitle>
                <Badge variant="outline" className="overview-chip h-5 text-[9px] border-blue-200 text-blue-700 bg-blue-50">
                  {records.length.toLocaleString('id-ID')} records
                </Badge>
                <Badge variant="outline" className="overview-chip h-5 text-[9px] border-emerald-200 text-emerald-700 bg-emerald-50">
                  {accountFramesByMode.labelB || '-'} vs {accountFramesByMode.labelA || '-'}
                </Badge>
              </div>

              <div ref={controlsRef} className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px]">
                <div className="overview-chip inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
                  {(['mom', 'yoy', 'ytd'] as const).map(m => (
                    <Button
                      key={m}
                      size="sm"
                      variant={compMode === m ? 'default' : 'ghost'}
                      onClick={() => setCompMode(m)}
                      className={`h-6 px-2 text-[9px] font-bold uppercase ${compMode === m ? 'bg-red-500 hover:bg-red-500 text-white' : 'text-slate-600 hover:bg-slate-200'}`}
                    >
                      {m}
                    </Button>
                  ))}
                </div>

                <div className="overview-chip inline-flex items-center gap-1.5 rounded-md border border-blue-100 bg-[#f4f8ff] px-2 py-1">
                  <span className="text-slate-500 font-semibold uppercase">Periode</span>
                  <select
                    value={compPeriode}
                    onChange={e => setCompPeriodeRaw(e.target.value)}
                    className="text-[10px] font-semibold border border-blue-200 rounded px-1.5 py-0.5 bg-white text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                  >
                    {allPeriodes.map(p => (
                      <option key={p} value={p}>{periodeToLabel(p)}</option>
                    ))}
                  </select>
                </div>

                <span className="overview-chip text-slate-500 w-full sm:w-auto sm:ml-auto">
                  Basis: <strong className="text-slate-700">{accountFramesByMode.labelB}</strong> vs <strong className="text-slate-700">{accountFramesByMode.labelA}</strong>
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-1.5 pt-1 flex-1 min-h-0 flex flex-col">
              <div className="mb-0.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-700">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: legendColors.prev }} />
                  <span>{accountFramesByMode.labelB || accountFramesByMode.tagB}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: legendColors.curr }} />
                  <span>{accountFramesByMode.labelA || accountFramesByMode.tagA}</span>
                </div>
              </div>
              <div className="grid gap-1.5 grid-cols-1 lg:grid-cols-2 flex-1 min-h-0">
                {accountFramesByMode.frames.map(frame => (
                  <Card key={frame.key} className="anim-card border border-slate-200 shadow-sm bg-white flex flex-col min-h-0">
                    <CardHeader className="p-1.5 pb-0.5">
                      <CardTitle className="text-xs font-semibold uppercase tracking-wide text-red-600">{frame.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-1.5 pt-0 flex-1 min-h-0">
                      {frame.rows.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-10">Tidak ada data akun pada periode ini</p>
                      ) : (
                        <div className="h-full flex flex-col gap-0.5">
                          <div className="flex-1 min-h-[200px] sm:min-h-[120px] w-full">
                            <ChartBar
                              data={buildOverviewChartData(
                                frame.rows,
                                accountFramesByMode.labelB || accountFramesByMode.tagB,
                                accountFramesByMode.labelA || accountFramesByMode.tagA,
                              )}
                              options={buildOverviewChartOptions(
                                isCompact,
                                accountFramesByMode.labelB || accountFramesByMode.tagB,
                                accountFramesByMode.labelA || accountFramesByMode.tagA,
                              )}
                            />
                          </div>

                          <div className="rounded-md border border-blue-100 bg-[#f8fbff] px-2 py-1.5 flex-none">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Reason Singkat</p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-5 px-1.5 text-[9px] border-blue-200 text-blue-700 hover:bg-blue-50"
                                onClick={() => setActiveReasonFrameKey(frame.key)}
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
            </CardContent>
          </Card>

        </div>{/* /content */}
      </div>{/* /main */}

      {activeReasonFrame && (
        <div
          ref={reasonOverlayRef}
          className="fixed inset-0 z-[70] bg-slate-900/35 backdrop-blur-[1px] px-3 py-5 sm:p-6 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveReasonFrameKey(null);
          }}
        >
          <Card ref={reasonPanelRef} className="w-full max-w-3xl border border-blue-100 shadow-2xl bg-white">
            <CardHeader className="p-3 pb-2 border-b border-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wide text-slate-800">
                    Reason Lengkap - {activeReasonFrame.title}
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {compMode.toUpperCase()} • {accountFramesByMode.labelB || accountFramesByMode.tagB} vs {accountFramesByMode.labelA || accountFramesByMode.tagA}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setActiveReasonFrameKey(null)}>
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
                    <p className="text-xs text-slate-500">Tidak ada detail klasifikasi movement pada frame ini.</p>
                  ) : (
                    activeReasonFrame.detailRows
                      .filter((row) => row.delta !== 0)
                      .map((row) => (
                        <div key={row.klasifikasi} className="reason-item rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-800">{row.klasifikasi}</p>
                            <Badge
                              variant="outline"
                              className={`h-5 text-[10px] ${row.delta >= 0 ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-rose-200 text-rose-700 bg-rose-50'}`}
                            >
                              {row.delta >= 0 ? 'Naik' : 'Turun'} {fmtCompact(Math.abs(row.delta))}
                            </Badge>
                            <span className="text-[10px] text-slate-500">{fmtCompact(row.prev)} {'->'} {fmtCompact(row.curr)}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 ml-auto text-[9px] text-blue-700 hover:bg-blue-100"
                              onClick={() => toggleReasonRow(`${activeReasonFrame.key}::${row.klasifikasi}`)}
                            >
                              {expandedReasonRows.has(`${activeReasonFrame.key}::${row.klasifikasi}`) ? 'Sembunyikan GL' : 'Lihat GL'}
                            </Button>
                          </div>
                          <p className="mt-1 text-[11px] leading-5 text-slate-600 whitespace-pre-wrap break-words">
                            {row.reason || autoReasonFromContributors(row)}
                          </p>
                          {expandedReasonRows.has(`${activeReasonFrame.key}::${row.klasifikasi}`) && (
                            <div className="mt-2 border-t border-slate-200 pt-2 space-y-1.5">
                              {row.contributors.length === 0 ? (
                                <p className="text-[10px] text-slate-500">Tidak ada rincian GL untuk klasifikasi ini.</p>
                              ) : (
                                (() => {
                                  const subtotalPrev = row.contributors.reduce((acc, c) => acc + c.prev, 0);
                                  const subtotalCurr = row.contributors.reduce((acc, c) => acc + c.curr, 0);
                                  const subtotalDelta = subtotalCurr - subtotalPrev;
                                  const isMatch = Math.abs(subtotalDelta - row.delta) <= SUBTOTAL_DELTA_EPSILON;

                                  return (
                                    <>
                                      {row.contributors.map((c) => (
                                        <div key={`${row.klasifikasi}::${c.accountCode}`} className="contrib-item rounded border border-slate-200 bg-white px-2 py-1.5">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <p className="text-[10px] font-semibold text-slate-700">{c.accountCode}</p>
                                            <span className="text-[10px] text-slate-500">{c.accountName}</span>
                                            <Badge
                                              variant="outline"
                                              className={`ml-auto h-5 text-[10px] ${c.delta >= 0 ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-rose-200 text-rose-700 bg-rose-50'}`}
                                            >
                                              {c.delta >= 0 ? '+' : '-'}{fmtCompact(Math.abs(c.delta))}
                                            </Badge>
                                          </div>
                                          <p className="text-[10px] text-slate-500 mt-0.5">{fmtCompact(c.prev)} {'->'} {fmtCompact(c.curr)}</p>
                                        </div>
                                      ))}

                                      <div className="contrib-item rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wide">Subtotal Klasifikasi</p>
                                          <Badge
                                            variant="outline"
                                            className={`ml-auto h-5 text-[10px] ${isMatch ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-amber-200 text-amber-700 bg-amber-50'}`}
                                          >
                                            {isMatch ? 'Match Delta' : 'Cek Selisih'}
                                          </Badge>
                                        </div>
                                        <p className="text-[10px] text-blue-900 mt-0.5">
                                          Prev {fmtCompact(subtotalPrev)} {'->'} Curr {fmtCompact(subtotalCurr)}
                                        </p>
                                        <p className="text-[10px] text-blue-900">
                                          Delta Subtotal {subtotalDelta >= 0 ? '+' : '-'}{fmtCompact(Math.abs(subtotalDelta))} • Delta Klasifikasi {row.delta >= 0 ? '+' : '-'}{fmtCompact(Math.abs(row.delta))}
                                        </p>
                                      </div>
                                    </>
                                  );
                                })()
                              )}
                            </div>
                          )}
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
