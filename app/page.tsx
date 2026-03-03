'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, CheckCircle, DollarSign, FileText, Package, CreditCard, Clock, BarChart2, Minus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Skeleton } from './components/ui/skeleton';
import { Separator } from './components/ui/separator';
import { cn } from '@/lib/utils';
import MetricCard from './components/MetricCard';
import RekonsiliasiCard from './components/RekonsiliasiCard';
import SimpleBarChart from './components/SimpleBarChart';
import DonutChart from './components/DonutChart';
import StatusCard from './components/StatusCard';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

const Sidebar = dynamic(() => import('./components/Sidebar'), { ssr: false });
const Header  = dynamic(() => import('./components/Header'),  { ssr: false });

/* ── Pure helpers (outside component — no re-creation on render) ── */
const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function periodeToLabel(p: string): string {
  const [yr, mo] = p.split('.');
  const m = parseInt(mo) - 1;
  return `${MONTHS_ID[m] ?? mo} ${yr}`;
}
function formatCurrency(amount: number): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (a >= 1_000_000_000_000) return `Rp ${sign}${(a / 1_000_000_000_000).toFixed(1).replace('.', ',')} T`;
  if (a >= 1_000_000_000)     return `Rp ${sign}${(a / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (a >= 1_000_000)         return `Rp ${sign}${Math.round(a / 1_000_000).toLocaleString('id-ID')} JT`;
  if (a >= 1_000)             return `Rp ${sign}${Math.round(a / 1_000).toLocaleString('id-ID')} RB`;
  return `Rp ${sign}${Math.round(a).toLocaleString('id-ID')}`;
}
function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(1).replace('.',',') + ' M';
  if (a >= 1_000_000)     return sign + Math.round(a / 1_000_000).toLocaleString('id-ID') + ' JT';
  if (a >= 1_000)         return sign + Math.round(a / 1_000).toLocaleString('id-ID') + ' RB';
  return sign + Math.round(a).toLocaleString('id-ID');
}

interface DashboardSummary {
  material: {
    summary: Array<{ label: string; value: number; amount: number; countSelisih: number; countClear: number }>;
    byType: Array<{ label: string; value: number }>;
    total: number;
  };
  prepaid: {
    status: { active: number; cleared: number; pending: number };
    financial: { total: number; cleared: number; remaining: number };
    topPrepaidByAmount: Array<{ label: string; value: number }>;
    topByKlasifikasi: Array<{ label: string; value: number }>;
    total: number;
  };
  accrual: {
    status: { active: number; cleared: number; pending: number };
    financial: { total: number; realized: number; remaining: number };
    topVendors: Array<{ label: string; value: number }>;
    topByKlasifikasi: Array<{ label: string; value: number }>;
    total: number;
  };
  fluktuasi: {
    total: number;
    netAmount: number;
    momChange: number;
    momPct: number;
    topByKlasifikasi: Array<{ label: string; value: number }>;
    last6Periodes: Array<{ periode: string; value: number }>;
  };
}

/* ── Module-level cache (survives re-renders, cleared on realtime push) ── */
let _cache: { data: DashboardSummary; ts: number } | null = null;
const CACHE_TTL = 90_000; // 90 seconds

export default function DashboardPage() {
  const contentRef   = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materialRef  = useRef<HTMLDivElement>(null);
  const fluktuasiRef = useRef<HTMLDivElement>(null);
  const trendRef     = useRef<HTMLDivElement>(null);

  /* ── GSAP: animate grid sections in on load ──────────────── */
  useEffect(() => {
    if (!contentRef.current) return;
    const sections = contentRef.current.querySelectorAll('.dashboard-section');
    if (sections.length === 0) return;
    gsap.fromTo(
      sections,
      { opacity: 0, y: 32 },
      { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out', stagger: 0.12, delay: 0.1 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [summary, setSummary] = useState<DashboardSummary | null>(
    _cache ? _cache.data : null
  );
  const [loading, setLoading]       = useState(!_cache);   // full skeleton
  const [refreshing, setRefreshing] = useState(false);      // top loading bar
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const fetchDashboardSummary = async (bustCache = false) => {
    if (!bustCache && _cache && Date.now() - _cache.ts < CACHE_TTL) {
      setSummary(_cache.data);
      setLoading(false);
      return;
    }
    try {
      if (!_cache) {
        setLoading(true);      // no data yet — show full skeleton
      } else {
        setRefreshing(true);   // stale data visible — show top bar only
      }
      const res = await fetch('/api/dashboard/summary');
      if (res.ok) {
        const data: DashboardSummary = await res.json();
        _cache = { data, ts: Date.now() };
        setSummary(data);
      }
    } catch (e) {
      console.error('Error fetching dashboard summary:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchDashboardSummary(); }, []);

  // Realtime: bust cache + debounced re-fetch
  useRealtimeUpdates(['accrual', 'prepaid', 'material', 'fluktuasi'], () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchDashboardSummary(true), 300);
  });

  const materialChartData = useMemo(() => {
    if (!summary) return [];
    return summary.material.summary.slice(0, 5).map(item => ({
      label: item.label,
      value: item.value,
      countSelisih: item.countSelisih,
      countClear: item.countClear,
    }));
  }, [summary]);

  const prepaidDonutData = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Active',  value: summary.prepaid.status.active,  color: '#2563eb' },
      { label: 'Cleared', value: summary.prepaid.status.cleared, color: '#059669' },
      { label: 'Pending', value: summary.prepaid.status.pending, color: '#f59e0b' },
    ];
  }, [summary]);

  const accrualDonutData = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Active',  value: summary.accrual.status.active,  color: '#dc2626' },
      { label: 'Cleared', value: summary.accrual.status.cleared, color: '#059669' },
      { label: 'Pending', value: summary.accrual.status.pending, color: '#f59e0b' },
    ];
  }, [summary]);

  const topAccrualByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.accrual.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const topPrepaidByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.prepaid.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const fluktuasiByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.fluktuasi.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  /* ── GSAP: animate material progress bars on data load + hover ── */
  useEffect(() => {
    if (!materialRef.current || !materialChartData.length) return;
    const bars = materialRef.current.querySelectorAll<HTMLElement>('.mat-bar');
    gsap.from(bars, { width: '0%', duration: 1.1, ease: 'power3.out', stagger: 0.08, delay: 0.15 });

    const rows = materialRef.current.querySelectorAll<HTMLElement>('.mat-row');
    const cleanups: (() => void)[] = [];
    rows.forEach(row => {
      const track = row.querySelector<HTMLElement>('.mat-track');
      const rowBars = row.querySelectorAll<HTMLElement>('.mat-bar');
      const onEnter = () => {
        gsap.to(row,    { y: -3, scale: 1.01, duration: 0.25, ease: 'power2.out' });
        gsap.to(track,  { boxShadow: '0 4px 16px rgba(0,0,0,0.15)', duration: 0.25 });
        gsap.to(rowBars, { filter: 'brightness(1.15)', duration: 0.2 });
      };
      const onLeave = () => {
        gsap.to(row,    { y: 0,  scale: 1,    duration: 0.3, ease: 'power2.inOut' });
        gsap.to(track,  { boxShadow: '0 0px 0px rgba(0,0,0,0)',  duration: 0.3 });
        gsap.to(rowBars, { filter: 'brightness(1)', duration: 0.25 });
      };
      row.addEventListener('mouseenter', onEnter);
      row.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        row.removeEventListener('mouseenter', onEnter);
        row.removeEventListener('mouseleave', onLeave);
      });
    });
    return () => cleanups.forEach(c => c());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialChartData]);

  /* ── anime.js: stagger + GSAP hover for fluktuasi stat cards ── */
  useEffect(() => {
    if (!fluktuasiRef.current) return;
    const cards = Array.from(fluktuasiRef.current.querySelectorAll<HTMLElement>('.flukt-card'));
    if (!cards.length) return;

    // entrance stagger
    animate(cards, {
      opacity:    [0, 1],
      translateY: [28, 0],
      scale:      [0.96, 1],
      duration:   500,
      delay:      stagger(100),
      ease:       'outExpo',
    });

    // GSAP hover per card
    const cleanups: (() => void)[] = [];
    cards.forEach(card => {
      const bar   = card.querySelector<HTMLElement>('.h-1');
      const value = card.querySelector<HTMLElement>('.text-2xl');
      const onEnter = () => {
        gsap.to(card,  { y: -6, scale: 1.02, boxShadow: '0 8px 28px rgba(0,0,0,0.12)', duration: 0.28, ease: 'power2.out' });
        if (bar)   gsap.to(bar,   { scaleX: 1.04, duration: 0.28, ease: 'power2.out', transformOrigin: 'left' });
        if (value) gsap.to(value, { scale: 1.06, duration: 0.22, ease: 'back.out(2)' });
      };
      const onLeave = () => {
        gsap.to(card,  { y: 0, scale: 1, boxShadow: '0 0px 0px rgba(0,0,0,0)', duration: 0.35, ease: 'power2.inOut' });
        if (bar)   gsap.to(bar,   { scaleX: 1, duration: 0.3, ease: 'power2.inOut', transformOrigin: 'left' });
        if (value) gsap.to(value, { scale: 1, duration: 0.28, ease: 'power2.inOut' });
      };
      card.addEventListener('mouseenter', onEnter);
      card.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        card.removeEventListener('mouseenter', onEnter);
        card.removeEventListener('mouseleave', onLeave);
      });
    });
    return () => cleanups.forEach(c => c());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.fluktuasi?.total]);

  /* ── GSAP: animate trend bars + hover ─────────────────── */
  useEffect(() => {
    if (!trendRef.current) return;
    const bars = trendRef.current.querySelectorAll<HTMLElement>('.trend-bar');
    if (!bars.length) return;

    // entrance
    gsap.from(bars, { width: '0%', duration: 0.9, ease: 'power2.out', stagger: 0.08, delay: 0.1 });

    // hover per row
    const rows = trendRef.current.querySelectorAll<HTMLElement>('.trend-row');
    const cleanups: (() => void)[] = [];
    rows.forEach(row => {
      const bar    = row.querySelector<HTMLElement>('.trend-bar');
      const label  = row.querySelector<HTMLElement>('.trend-label');
      const value  = row.querySelector<HTMLElement>('.trend-value');
      const track  = row.querySelector<HTMLElement>('.trend-track');
      const onEnter = () => {
        gsap.to(row,   { y: -2, duration: 0.22, ease: 'power2.out' });
        if (bar)   gsap.to(bar,   { filter: 'brightness(1.2) saturate(1.3)', duration: 0.2 });
        if (track) gsap.to(track, { boxShadow: '0 2px 12px rgba(0,0,0,0.1)', duration: 0.22 });
        if (label) gsap.to(label, { x: 4, duration: 0.22, ease: 'power2.out' });
        if (value) gsap.to(value, { scale: 1.08, duration: 0.2, ease: 'back.out(2)' });
      };
      const onLeave = () => {
        gsap.to(row,   { y: 0, duration: 0.3, ease: 'power2.inOut' });
        if (bar)   gsap.to(bar,   { filter: 'brightness(1) saturate(1)', duration: 0.28 });
        if (track) gsap.to(track, { boxShadow: '0 0px 0px rgba(0,0,0,0)', duration: 0.3 });
        if (label) gsap.to(label, { x: 0, duration: 0.28, ease: 'power2.inOut' });
        if (value) gsap.to(value, { scale: 1, duration: 0.28, ease: 'power2.inOut' });
      };
      row.addEventListener('mouseenter', onEnter);
      row.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        row.removeEventListener('mouseenter', onEnter);
        row.removeEventListener('mouseleave', onLeave);
      });
    });
    return () => cleanups.forEach(c => c());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.fluktuasi?.last6Periodes]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-background lg:ml-64">
        {/* Top loading bar — shown during background refetch */}
        {refreshing && (
          <div className="fixed top-0 left-0 right-0 z-[100] h-1 overflow-hidden">
            <div className="h-full bg-primary animate-[loadingBar_1.2s_ease-in-out_infinite]" />
          </div>
        )}
        <Header
          title="Dashboard"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          subtitle="Ringkasan aktivitas dan monitoring accrual"
        />

        <div ref={contentRef} className="p-4 sm:p-6 md:p-8 space-y-6">

          {/* ─── Metric Cards ─────────────────────────────────── */}
          <div className="dashboard-section grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Accrual"       value={formatCurrency(summary?.accrual?.financial?.total     ?? 0)} icon={<TrendingUp  className="w-5 h-5" />} color="blue"   />
            <MetricCard title="Total Realisasi"     value={formatCurrency(summary?.accrual?.financial?.realized  ?? 0)} icon={<CheckCircle className="w-5 h-5" />} color="green"  />
            <MetricCard title="Total Saldo Accrual" value={formatCurrency(Math.abs(summary?.accrual?.financial?.remaining ?? 0))} icon={<DollarSign  className="w-5 h-5" />} color="red"    />
            <MetricCard title="Jumlah Accrual"      value={(summary?.accrual?.total ?? 0).toString()}             icon={<FileText    className="w-5 h-5" />} color="purple" />
          </div>

          {/* ─── Additional Overview Cards ─────────────────────── */}
          {summary && (
            <div className="dashboard-section grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard title="Total Material" value={summary.material.total.toString()}                   icon={<Package    className="w-5 h-5" />} color="indigo" />
              <MetricCard title="Total Prepaid"  value={summary.prepaid.total.toString()}                    icon={<CreditCard className="w-5 h-5" />} color="teal"   />
              <MetricCard title="Saldo Prepaid"  value={formatCurrency(summary.prepaid.financial.remaining)} icon={<Clock      className="w-5 h-5" />} color="orange" />
            </div>
          )}

          {/* ─── Loading skeleton ──────────────────────────────── */}
          {loading && (
            <div className="space-y-4">
              {/* Material bars skeleton */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-5 w-28 rounded-full" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-1/4" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-8 w-full rounded-full" />
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              {/* Donut charts skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[0, 1].map(i => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-36" /></CardHeader>
                    <CardContent className="flex gap-6 items-center">
                      <Skeleton className="h-36 w-36 rounded-full shrink-0 mx-auto lg:mx-0" />
                      <div className="flex-1 space-y-2 hidden lg:block">
                        {[...Array(3)].map((_, j) => (
                          <div key={j} className="flex items-center gap-2">
                            <Skeleton className="h-3 w-3 rounded-full" />
                            <Skeleton className="h-3 flex-1" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {/* Bar charts skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[0, 1].map(i => (
                  <Card key={i}>
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-48" /></CardHeader>
                    <CardContent className="space-y-3">
                      {[...Array(5)].map((_, j) => (
                        <div key={j} className="flex items-center gap-3">
                          <Skeleton className="h-3 w-20 shrink-0" />
                          <Skeleton className="h-5 flex-1 rounded-full" />
                          <Skeleton className="h-3 w-14 shrink-0" />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* ─── Charts ─────────────────────────────────────────── */}
          {!loading && summary && (
            <>
              {/* Material stacked progress bars */}
              <div className="dashboard-section">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-base sm:text-lg">Top 5 Material per Plant</CardTitle>
                      <Badge variant="outline" className="text-xs">Berdasarkan Selisih</Badge>
                    </div>
                  </CardHeader>
                  <CardContent ref={materialRef}>
                    <div className="space-y-4">
                      {materialChartData.map((item, index) => {
                        const total          = item.countSelisih + item.countClear;
                        const selisihPercent = total > 0 ? (item.countSelisih / total) * 100 : 0;
                        const clearPercent   = total > 0 ? (item.countClear   / total) * 100 : 0;
                        return (
                          <div key={index} className="mat-row space-y-1.5 cursor-pointer">
                            <div className="flex justify-between items-center text-sm">
                              <span className="font-medium text-foreground">{item.label}</span>
                              <span className="text-xs text-muted-foreground">
                                Selisih: {item.countSelisih} | Clear: {item.countClear}
                              </span>
                            </div>
                            <div className="mat-track relative h-8 bg-muted rounded-full overflow-hidden">
                              <div
                                className="mat-bar absolute left-0 top-0 h-full bg-destructive rounded-l-full"
                                style={{ width: `${selisihPercent}%` }}
                              >
                                {selisihPercent > 15 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                                    {selisihPercent.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              <div
                                className="mat-bar absolute right-0 top-0 h-full bg-green-500 rounded-r-full"
                                style={{ width: `${clearPercent}%` }}
                              >
                                {clearPercent > 15 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                                    {clearPercent.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Total Selisih: {formatCurrency(item.value)}</span>
                              <span>Total: {total} items</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Separator className="my-4" />
                    <div className="flex gap-5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-destructive" />
                        <span className="text-muted-foreground">Ada Selisih</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-green-500" />
                        <span className="text-muted-foreground">Clear</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Prepaid & Accrual donut charts */}
              <div className="dashboard-section grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DonutChart data={prepaidDonutData} title="Status Prepaid"  centerText={summary.prepaid.total.toString()} centerSubtext="Total Prepaid" />
                <DonutChart data={accrualDonutData} title="Status Accrual"  centerText={summary.accrual.total.toString()} centerSubtext="Saldo" />
              </div>

              {/* Top classification bar charts */}
              <div className="dashboard-section grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SimpleBarChart data={topAccrualByKlasifikasiData} title="Top 5 Accrual (Berdasarkan Klasifikasi)"  color="#dc2626" />
                <SimpleBarChart data={topPrepaidByKlasifikasiData} title="Top 5 Prepaid (Berdasarkan Klasifikasi)"  color="#059669" />
              </div>

              {/* ─── Fluktuasi OI/EXP ─────────────────────────────── */}
              {summary.fluktuasi.total > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-2">
                    <BarChart2 className="w-5 h-5 text-primary shrink-0" />
                    <h3 className="text-base sm:text-lg font-semibold text-foreground">Ringkasan Fluktuasi OI/EXP</h3>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {summary.fluktuasi.total.toLocaleString('id-ID')} records
                    </Badge>
                  </div>

                  {/* Fluktuasi stat cards — animated by anime.js stagger */}
                  <div ref={fluktuasiRef} className="dashboard-section grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="flukt-card overflow-hidden cursor-pointer">
                      <div className="h-1 bg-primary" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1">Total Records</p>
                        <p className="text-2xl font-bold text-foreground">{summary.fluktuasi.total.toLocaleString('id-ID')}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">akun-periode tersimpan</p>
                      </CardContent>
                    </Card>

                    <Card className="flukt-card overflow-hidden cursor-pointer">
                      <div className="h-1 bg-violet-500" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1">Net Amount</p>
                        <p className="text-2xl font-bold text-foreground">{fmtCompact(summary.fluktuasi.netAmount)}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">total semua periode</p>
                      </CardContent>
                    </Card>

                    <Card className="flukt-card overflow-hidden cursor-pointer">
                      <div className={cn('h-1', {
                        'bg-muted':       summary.fluktuasi.momChange === 0,
                        'bg-destructive': summary.fluktuasi.momChange > 0,
                        'bg-green-500':   summary.fluktuasi.momChange < 0,
                      })} />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1">Perubahan MoM</p>
                        <div className="flex items-center gap-2 mt-1">
                          {summary.fluktuasi.momChange === 0 ? (
                            <Minus className="w-5 h-5 text-muted-foreground" />
                          ) : summary.fluktuasi.momChange > 0 ? (
                            <TrendingUp className="w-5 h-5 text-destructive" />
                          ) : (
                            <TrendingDown className="w-5 h-5 text-green-600" />
                          )}
                          <p className={cn('text-2xl font-bold', {
                            'text-muted-foreground': summary.fluktuasi.momChange === 0,
                            'text-destructive':      summary.fluktuasi.momChange > 0,
                            'text-green-600':        summary.fluktuasi.momChange < 0,
                          })}>
                            {summary.fluktuasi.momChange > 0 ? '+' : ''}{fmtCompact(summary.fluktuasi.momChange)}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {summary.fluktuasi.momPct !== 0
                            ? `${summary.fluktuasi.momPct > 0 ? '+' : ''}${summary.fluktuasi.momPct.toFixed(1)}% vs bulan lalu`
                            : 'vs bulan lalu'}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Fluktuasi charts */}
                  <div className="dashboard-section grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <SimpleBarChart data={fluktuasiByKlasifikasiData} title="Top 5 Fluktuasi (Berdasarkan Klasifikasi)" color="#7c3aed" />

                    {/* Trend 6 periode — bars animated by GSAP */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm sm:text-base">Trend 6 Periode Terakhir</CardTitle>
                      </CardHeader>
                      <CardContent ref={trendRef}>
                        {summary.fluktuasi.last6Periodes.length > 0 ? (
                          <div className="space-y-3">
                            {(() => {
                              const maxAbs = Math.max(...summary.fluktuasi.last6Periodes.map(p => Math.abs(p.value)), 1);
                              return summary.fluktuasi.last6Periodes.map((p, i) => {
                                const pct    = Math.abs(p.value) / maxAbs * 100;
                                const isLast = i === summary.fluktuasi.last6Periodes.length - 1;
                                return (
                                  <div key={p.periode} className="trend-row space-y-1 cursor-pointer">
                                    <div className="flex justify-between text-xs">
                                      <span className={cn('trend-label font-medium', isLast ? 'text-primary' : 'text-muted-foreground')}>
                                        {periodeToLabel(p.periode)}
                                      </span>
                                      <span className={cn('trend-value font-semibold', p.value < 0 ? 'text-green-600' : 'text-destructive')}>
                                        {p.value > 0 ? '+' : ''}{fmtCompact(p.value)}
                                      </span>
                                    </div>
                                    <div className="trend-track h-5 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className={cn('trend-bar h-full rounded-full', {
                                          'bg-primary':         isLast,
                                          'bg-green-400':      !isLast && p.value < 0,
                                          'bg-destructive/70': !isLast && p.value >= 0,
                                        })}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">Belum ada data periode</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}

              {/* Status Summary */}
              <div className="dashboard-section">
                <StatusCard
                  title="Ringkasan Status"
                  items={[
                    { label: 'Prepaid Active',  count: summary.prepaid.status.active,  status: 'success' },
                    { label: 'Prepaid Pending', count: summary.prepaid.status.pending, status: 'warning' },
                    { label: 'Accrual Active',  count: summary.accrual.status.active,  status: 'error'   },
                    { label: 'Accrual Pending', count: summary.accrual.status.pending, status: 'pending' },
                  ]}
                />
              </div>
            </>
          )}

          {/* ─── Rekonsiliasi ──────────────────────────────────────── */}
          <div className="dashboard-section grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RekonsiliasiCard
              title="Rekonsiliasi Accrual vs Realisasi"
              description="Monitoring selisih antara accrual yang dicatat dengan realisasi pembayaran"
              status={summary?.accrual?.financial?.total ? (( summary.accrual.financial.realized / summary.accrual.financial.total) >= 0.8 ? 'normal' : 'warning') : 'normal'}
              percentage={summary?.accrual?.financial?.total ? Math.round((summary.accrual.financial.realized / summary.accrual.financial.total) * 100) : 0}
            />
            <RekonsiliasiCard
              title="Status Prepaid"
              description="Tracking prepaid yang telah diamortisasi"
              status={summary?.prepaid?.financial?.total && summary.prepaid.financial.total > 0 ? (summary.prepaid.financial.cleared / summary.prepaid.financial.total >= 0.7 ? 'normal' : 'warning') : 'normal'}
              percentage={summary?.prepaid?.financial?.total && summary.prepaid.financial.total > 0 ? Math.round((summary.prepaid.financial.cleared / summary.prepaid.financial.total) * 100) : 0}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
