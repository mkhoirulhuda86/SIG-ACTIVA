'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import dynamic from 'next/dynamic';
import { Activity, TrendingUp } from 'lucide-react';
import { gsap } from 'gsap';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';

const Sidebar  = dynamic(() => import('../components/Sidebar'),  { ssr: false });
const Header   = dynamic(() => import('../components/Header'),   { ssr: false });

/* ─── Loading Skeleton ──────────────────────────────────────────────────────── */
function PageSkeleton({ isMobileSidebarOpen, setMobileSidebar }: { isMobileSidebarOpen: boolean; setMobileSidebar: (v: boolean) => void }) {
  const skeletonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!skeletonRef.current) return;
    const cards = skeletonRef.current.querySelectorAll('.sk-card');
    gsap.fromTo(cards, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, ease: 'power3.out' });
  }, []);
  return (
    <div className="flex min-h-screen bg-[#f0f4fa]">
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col">
        <Header title="Overview Fluktuasi OI/EXP" subtitle="Memuat data…" onMenuClick={() => setMobileSidebar(true)} />
        {/* Shimmer year bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-20 rounded-md" />
          ))}
        </div>
        <div ref={skeletonRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Row 1 skeleton */}
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(240px,280px)_1fr_minmax(200px,220px)]">
            <div className="sk-card flex flex-col gap-3">
              <Card className="p-3">
                <Skeleton className="h-4 w-32 mb-3" />
                <div className="flex gap-2">
                  <Skeleton className="rounded-full w-36 h-36" />
                  <div className="flex-1 space-y-2 mt-2">
                    {[...Array(6)].map((_,i) => <Skeleton key={i} className="h-3 w-full" />)}
                  </div>
                </div>
              </Card>
              <Card className="p-3">
                <Skeleton className="h-4 w-28 mb-3" />
                {[...Array(4)].map((_,i) => <Skeleton key={i} className="h-10 w-full mb-2 rounded-md" />)}
              </Card>
            </div>
            <div className="sk-card flex flex-col gap-3">
              <Card className="p-3">
                <Skeleton className="h-4 w-48 mb-3 mx-auto" />
                <div className="flex flex-wrap justify-center gap-3">
                  {[...Array(6)].map((_,i) => <Skeleton key={i} className="w-24 h-24 rounded-full" />)}
                </div>
              </Card>
              <Card className="p-3">
                <Skeleton className="h-4 w-40 mb-2" />
                <Skeleton className="h-36 w-full" />
              </Card>
            </div>
            <Card className="sk-card p-3">
              <Skeleton className="h-4 w-16 mb-3" />
              {[...Array(8)].map((_,i) => <Skeleton key={i} className="h-5 w-full mb-1.5 rounded" />)}
            </Card>
          </div>
          {/* Row 2 */}
          <div className="sk-card grid gap-3 grid-cols-1 md:grid-cols-[1fr_minmax(300px,380px)]">
            <Card className="p-3">
              <Skeleton className="h-4 w-32 mb-2" /><Skeleton className="h-56 w-full" />
            </Card>
            <Card className="p-3">
              <Skeleton className="h-4 w-40 mb-2" />
              {[...Array(10)].map((_,i) => <Skeleton key={i} className="h-5 w-full mb-1.5 rounded" />)}
            </Card>
          </div>
          {/* Table */}
          <Card className="sk-card overflow-hidden">
            <div className="border-b px-4 py-2.5"><Skeleton className="h-4 w-40" /></div>
            <div className="p-3 space-y-2">
              {[...Array(8)].map((_,i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
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
  klasifikasi: string;
  remark: string;
};

type ParsedRecord = {
  accountCode: string;
  periode: string;
  amount: number;
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

const EXCLUDED_OVERVIEW_ACCOUNT_CODES = new Set([
  '71510000', // BEBAN BUNGA PINJAMAN
  '71400000', // PENDAPATAN KLAIM
  '71560000', // BEBAN LAIN-LAIN
  '71300000', // PENDAPATAN BUNGA
  '71600000', // LABA (RUGI) SELISIH KURS
]);

type FrameDef = {
  key: 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';
  title: string;
  match: (accountCode: string) => boolean;
};

const FRAME_DEFS: FrameDef[] = [
  {
    key: 'beban-bunga',
    title: 'Beban Bunga',
    match: (accountCode: string) => accountCode.startsWith('7151'),
  },
  {
    key: 'pendapatan-lain',
    title: 'Pendapatan Lain-Lain',
    match: (accountCode: string) => accountCode.startsWith('714') || accountCode.startsWith('7156'),
  },
  {
    key: 'pendapatan-bunga',
    title: 'Pendapatan Bunga',
    match: (accountCode: string) => accountCode.startsWith('713'),
  },
  {
    key: 'selisih-kurs',
    title: 'Laba (Rugi) Selisih Kurs',
    match: (accountCode: string) => accountCode.startsWith('716'),
  },
];


// ─── Year Comparison Row (2025 vs 2026) ──────────────────────────────────────
function YearCompRow({
  label, v2025, v2026, maxVal, rank, animDelay = 0, tagA = '26', tagB = '25',
}: { label: string; v2025: number; v2026: number; maxVal: number; rank: number; animDelay?: number; tagA?: string; tagB?: string }) {
  const bar25Ref = useRef<HTMLDivElement>(null);
  const bar26Ref = useRef<HTMLDivElement>(null);
  const rowRef   = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const pct25 = maxVal > 0 ? (Math.abs(v2025) / maxVal) * 100 : 0;
  const pct26 = maxVal > 0 ? (Math.abs(v2026) / maxVal) * 100 : 0;
  const delta = v2026 - v2025;
  const deltaDir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const deltaPct = v2025 !== 0 ? (delta / Math.abs(v2025)) * 100 : null;

  useEffect(() => {
    if (mountedRef.current || !rowRef.current || !bar25Ref.current || !bar26Ref.current) return;
    mountedRef.current = true;
    gsap.fromTo(rowRef.current, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.45, delay: animDelay / 1000, ease: 'power3.out' });
    gsap.fromTo(bar25Ref.current, { height: '0%' }, { height: `${pct25}%`, duration: 0.9, delay: animDelay / 1000 + 0.1, ease: 'power3.out' });
    gsap.fromTo(bar26Ref.current, { height: '0%' }, { height: `${pct26}%`, duration: 0.9, delay: animDelay / 1000 + 0.2, ease: 'power3.out' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mountedRef.current || !bar25Ref.current || !bar26Ref.current) return;
    gsap.to(bar25Ref.current, { height: `${pct25}%`, duration: 0.5, ease: 'power2.out' });
    gsap.to(bar26Ref.current, { height: `${pct26}%`, duration: 0.5, ease: 'power2.out' });
  }, [pct25, pct26]);

  return (
    <div ref={rowRef} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] w-4 text-right flex-shrink-0 text-slate-400">{rank}.</span>
        <span className="text-[10px] font-semibold text-slate-700 flex-1 min-w-0 truncate" title={label}>
          {label}
        </span>
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0 px-1 rounded"
          style={{
            color: deltaDir === 'up' ? '#16a34a' : deltaDir === 'down' ? '#dc2626' : '#94a3b8',
            backgroundColor: deltaDir === 'up' ? '#f0fdf4' : deltaDir === 'down' ? '#fef2f2' : '#f8fafc',
          }}
        >
          {deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : '─'}{' '}
          {fmtCompact(Math.abs(delta))}
          {deltaPct !== null && <span className="text-[8px] opacity-70 ml-0.5">({Math.abs(deltaPct).toFixed(0)}%)</span>}
        </span>
      </div>

      <div className="mt-1.5 flex items-end justify-center gap-4 rounded-md border border-slate-100 bg-white p-2">
        <div className="flex flex-col items-center gap-1" style={{ width: 72 }}>
          <span className="text-[8px] text-slate-500 font-semibold">{tagB}</span>
          <div className="h-20 w-8 rounded bg-slate-100 relative flex items-end overflow-hidden">
            <div
              ref={bar25Ref}
              className="w-full rounded-t"
              style={{ height: '0%', backgroundColor: '#2563eb', opacity: 0.82 }}
            />
          </div>
          <span className="text-[8.5px] font-semibold text-slate-700 text-center leading-tight">
            {v2025 !== 0 ? fmtCompact(v2025) : '—'}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1" style={{ width: 72 }}>
          <span className="text-[8px] text-slate-500 font-semibold">{tagA}</span>
          <div className="h-20 w-8 rounded bg-slate-100 relative flex items-end overflow-hidden">
            <div
              ref={bar26Ref}
              className="w-full rounded-t"
              style={{ height: '0%', backgroundColor: '#16a34a', opacity: 0.82 }}
            />
          </div>
          <span className="text-[8.5px] font-semibold text-slate-700 text-center leading-tight">
            {v2026 !== 0 ? fmtCompact(v2026) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

function AccountFrameCard({
  title,
  rows,
  maxVal,
  tagA,
  tagB,
}: {
  title: string;
  rows: { accountCode: string; prev: number; curr: number }[];
  maxVal: number;
  tagA: string;
  tagB: string;
}) {
  const totalPrev = rows.reduce((s, r) => s + r.prev, 0);
  const totalCurr = rows.reduce((s, r) => s + r.curr, 0);
  const delta = totalCurr - totalPrev;

  return (
    <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-red-600">{title}</CardTitle>
        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
          <span className="text-[10px] text-slate-500">{tagB}: <strong className="text-slate-700 font-mono">{fmtCompact(totalPrev)}</strong></span>
          <span className="text-[10px] text-slate-500">{tagA}: <strong className="text-slate-700 font-mono">{fmtCompact(totalCurr)}</strong></span>
          <span className="text-[10px] font-mono font-bold" style={{ color: delta >= 0 ? '#16a34a' : '#dc2626' }}>
            {delta >= 0 ? '▲' : '▼'} {fmtCompact(Math.abs(delta))}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {rows.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">Tidak ada data akun pada periode ini</p>
          )}
          {rows.map((row, i) => (
            <YearCompRow
              key={row.accountCode}
              label={row.accountCode}
              v2025={row.prev}
              v2026={row.curr}
              maxVal={maxVal}
              rank={i + 1}
              animDelay={i * 30}
              tagA={tagA}
              tagB={tagB}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OverviewFluktuasiPage() {
  const [records, setRecords]                   = useState<ParsedRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  const [compMode,       setCompMode]       = useState<'mom' | 'yoy' | 'ytd'>('yoy');
  const [compPeriodeRaw, setCompPeriodeRaw] = useState<string>('');

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    // ?slim=1 → server selects only the 4 needed columns (no remark/uploadedBy/etc.)
    fetch('/api/fluktuasi/akun-periodes?slim=1')
      .then(r => r.json())
      .then((data: { success: boolean; data: AkunPeriodeRecord[] }) => {
        if (data.success && Array.isArray(data.data)) {
          // Pre-parse klasifikasi and year ONCE here → all memos reuse the result
          setRecords(data.data.map(r => ({
            accountCode: r.accountCode,
            periode:     r.periode,
            amount:      r.amount,
          })));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
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
        frames: FRAME_DEFS.map(frame => ({ ...frame, rows: [] as { accountCode: string; prev: number; curr: number }[], maxVal: 1 })),
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

    const frameMaps = FRAME_DEFS.map(frame => ({
      ...frame,
      mapA: new Map<string, number>(),
      mapB: new Map<string, number>(),
      allAccounts: new Set<string>(),
    }));

    for (const r of records) {
      if (EXCLUDED_OVERVIEW_ACCOUNT_CODES.has(r.accountCode)) continue;
      const frame = frameMaps.find(f => f.match(r.accountCode));
      if (!frame) continue;

      frame.allAccounts.add(r.accountCode);

      if (periodesA.has(r.periode)) {
        frame.mapA.set(r.accountCode, (frame.mapA.get(r.accountCode) ?? 0) + r.amount);
      } else if (periodesB.has(r.periode)) {
        frame.mapB.set(r.accountCode, (frame.mapB.get(r.accountCode) ?? 0) + r.amount);
      }
    }

    const frames = frameMaps.map(frame => {
      const rows = [...frame.allAccounts].map(accountCode => ({
        accountCode,
        prev: frame.mapB.get(accountCode) ?? 0,
        curr: frame.mapA.get(accountCode) ?? 0,
      }));
      rows.sort((a, b) => Math.max(Math.abs(b.prev), Math.abs(b.curr)) - Math.max(Math.abs(a.prev), Math.abs(a.curr)));
      const maxVal = Math.max(...rows.flatMap(r => [Math.abs(r.prev), Math.abs(r.curr)]), 1);
      return {
        key: frame.key,
        title: frame.title,
        rows,
        maxVal,
      };
    });

    return { frames, labelA, labelB, tagA, tagB };
  }, [records, compMode, compPeriode]);

  // ── Refs for GSAP page animations ─────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Table rows: simple CSS fade (no JS stagger on filter change — too expensive)
  // The initial page-entry GSAP timeline already handles first-render animation.

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton isMobileSidebarOpen={isMobileSidebarOpen} setMobileSidebar={setMobileSidebar} />;

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (records.length === 0) return (
    <div className="flex min-h-screen bg-[#f0f4fa]">
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
    <div className="flex min-h-screen bg-[#f0f4fa]">
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
        <div ref={contentRef} className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* 4 Frames: Perbandingan kode akun sesuai kelompok utama */}
          <Card className="shadow-sm border-0 bg-white">
            <CardHeader className="p-3 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Activity size={12} className="text-red-500" /> OVERVIEW 4 FRAME KODE AKUN
                </CardTitle>
                <div className="flex gap-1 ml-auto">
                  {(['mom', 'yoy', 'ytd'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setCompMode(m)}
                      className="px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-all duration-200 hover:scale-105 active:scale-95"
                      style={{ backgroundColor: compMode === m ? '#dc2626' : '#f1f5f9', color: compMode === m ? 'white' : '#64748b' }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px]">
                <span className="text-slate-400 font-semibold uppercase">Periode:</span>
                <select
                  value={compPeriode}
                  onChange={e => setCompPeriodeRaw(e.target.value)}
                  className="text-[9px] font-mono font-semibold border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-slate-700 focus:outline-none focus:border-blue-400 transition-colors"
                >
                  {allPeriodes.map(p => (
                    <option key={p} value={p}>{periodeToLabel(p)}</option>
                  ))}
                </select>
                <span className="text-slate-400 ml-auto">
                  Basis: <strong className="text-slate-600">{accountFramesByMode.labelB}</strong> vs <strong className="text-slate-600">{accountFramesByMode.labelA}</strong>
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-2">
              <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                {accountFramesByMode.frames.map(frame => (
                  <AccountFrameCard
                    key={frame.key}
                    title={frame.title}
                    rows={frame.rows}
                    maxVal={frame.maxVal}
                    tagA={accountFramesByMode.tagA}
                    tagB={accountFramesByMode.tagB}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

        </div>{/* /content */}
      </div>{/* /main */}
    </div>
  );
}
