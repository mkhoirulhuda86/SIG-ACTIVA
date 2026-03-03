'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalAccrual: 0,
    totalRealisasi: 0,
    totalSaldo: 0,
    jumlahAccrual: 0,
  });

  const contentRef   = useRef<HTMLDivElement>(null);
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

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    fetchDashboardStats();
    fetchDashboardSummary();
  }, []);

  // Realtime: re-fetch whenever accrual, prepaid, material, or fluktuasi data changes
  useRealtimeUpdates(['accrual', 'prepaid', 'material', 'fluktuasi'], (event) => {
    if (event === 'accrual') {
      fetchDashboardStats();
    }
    fetchDashboardSummary();
  });

  const fetchDashboardStats = useCallback(async () => {
    try {
      const response = await fetch('/api/accrual');
      if (response.ok) {
        const accruals = await response.json();

        const bulanMap: Record<string, number> = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
          'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11,
        };

        const calcAccrual = (item: any): number => {
          if (!item.periodes || item.periodes.length === 0) return 0;
          if (item.pembagianType === 'manual') {
            return item.periodes.reduce((s: number, p: any) => s + Math.abs(p.amountAccrual || 0), 0);
          }
          const today = new Date();
          const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          let total = 0;
          let rollover = 0;
          for (const p of item.periodes) {
            const [bulanName, tahunStr] = (p.bulan as string).split(' ');
            const periodeBulan = bulanMap[bulanName] ?? 0;
            const periodeTahun = parseInt(tahunStr);
            const periodeDate = new Date(periodeTahun, periodeBulan, 1);
            const realisasiPeriode = p.totalRealisasi ?? 0;
            const totalAvailable = realisasiPeriode + rollover;
            const capAccrual = Math.abs(p.amountAccrual || 0);
            const effectiveRealisasi = Math.min(totalAvailable, capAccrual);
            const newRollover = Math.max(0, totalAvailable - capAccrual);
            const isPastDue = todayDate >= periodeDate;
            const hasEffective = effectiveRealisasi > 0;
            if (isPastDue || hasEffective) total += capAccrual;
            rollover = newRollover;
          }
          return total;
        };

        const calcRawRealisasi = (item: any): number => {
          if (!item.periodes || item.periodes.length === 0) return 0;
          return item.periodes.reduce((s: number, p: any) => s + (p.totalRealisasi ?? 0), 0);
        };

        let totalAccrualSum = 0;
        let totalRealisasiSum = 0;
        let totalSaldoSum = 0;
        accruals.forEach((item: any) => {
          const saldoAwal = item.saldoAwal != null ? Number(item.saldoAwal) : Math.abs(item.totalAmount || 0);
          const totalAccrualItem = calcAccrual(item);
          const rawRealisasiItem = calcRawRealisasi(item);
          totalAccrualSum += totalAccrualItem;
          totalRealisasiSum += rawRealisasiItem;
          totalSaldoSum += saldoAwal + totalAccrualItem - rawRealisasiItem;
        });
        setStats({
          totalAccrual: totalAccrualSum,
          totalRealisasi: totalRealisasiSum,
          totalSaldo: totalSaldoSum,
          jumlahAccrual: accruals.length,
        });
      }
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    }
  }, []);

  const fetchDashboardSummary = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/dashboard/summary');
      if (response.ok) {
        const data = await response.json();
        setSummary(data);
      }
    } catch (error) {
      console.error('Error fetching dashboard summary:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const formatCurrency = useCallback((amount: number) => {
    const a = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (a >= 1_000_000_000_000) return `Rp ${sign}${(a / 1_000_000_000_000).toFixed(1).replace('.', ',')} T`;
    if (a >= 1_000_000_000)     return `Rp ${sign}${(a / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
    if (a >= 1_000_000)         return `Rp ${sign}${Math.round(a / 1_000_000).toLocaleString('id-ID')} JT`;
    if (a >= 1_000)             return `Rp ${sign}${Math.round(a / 1_000).toLocaleString('id-ID')} RB`;
    return `Rp ${sign}${Math.round(a).toLocaleString('id-ID')}`;
  }, []);

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const topAccrualVendorsData = useMemo(() => {
    if (!summary) return [];
    return summary.accrual.topVendors.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const topAccrualByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.accrual.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const topPrepaidByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.prepaid.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const topPrepaidByAmountData = useMemo(() => {
    if (!summary) return [];
    return summary.prepaid.topPrepaidByAmount.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const fluktuasiByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.fluktuasi.topByKlasifikasi.map(v => ({ label: v.label, value: v.value }));
  }, [summary]);

  const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const periodeToLabel = (p: string): string => {
    const [yr, mo] = p.split('.');
    const m = parseInt(mo) - 1;
    return `${MONTHS_ID[m] ?? mo} ${yr}`;
  };

  const fmtCompact = (n: number): string => {
    const a = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(1).replace('.',',') + ' M';
    if (a >= 1_000_000)     return sign + Math.round(a / 1_000_000).toLocaleString('id-ID') + ' JT';
    if (a >= 1_000)         return sign + Math.round(a / 1_000).toLocaleString('id-ID') + ' RB';
    return sign + Math.round(a).toLocaleString('id-ID');
  };

  /* ── GSAP: animate material progress bars on data load ────── */
  useEffect(() => {
    if (!materialRef.current || !materialChartData.length) return;
    const bars = materialRef.current.querySelectorAll('.mat-bar');
    gsap.from(bars, { width: '0%', duration: 1.1, ease: 'power3.out', stagger: 0.08, delay: 0.15 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialChartData]);

  /* ── anime.js: stagger fluktuasi stat cards ─────────────────── */
  useEffect(() => {
    if (!fluktuasiRef.current) return;
    const cards = fluktuasiRef.current.querySelectorAll('.flukt-card');
    if (!cards.length) return;
    animate(cards, {
      opacity:    [0, 1],
      translateY: [28, 0],
      scale:      [0.96, 1],
      duration:   500,
      delay:      stagger(100),
      ease:       'outExpo',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.fluktuasi?.total]);

  /* ── GSAP: animate trend bars ───────────────────────────────── */
  useEffect(() => {
    if (!trendRef.current) return;
    const bars = trendRef.current.querySelectorAll('.trend-bar');
    if (!bars.length) return;
    gsap.from(bars, { width: '0%', duration: 0.9, ease: 'power2.out', stagger: 0.08, delay: 0.1 });
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
        <Header
          title="Dashboard"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          subtitle="Ringkasan aktivitas dan monitoring accrual"
        />

        <div ref={contentRef} className="p-4 sm:p-6 md:p-8 space-y-6">

          {/* ─── Metric Cards ─────────────────────────────────── */}
          <div className="dashboard-section grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Accrual"       value={formatCurrency(stats.totalAccrual)}          icon={<TrendingUp  className="w-5 h-5" />} color="blue"   />
            <MetricCard title="Total Realisasi"     value={formatCurrency(stats.totalRealisasi)}        icon={<CheckCircle className="w-5 h-5" />} color="green"  />
            <MetricCard title="Total Saldo Accrual" value={formatCurrency(Math.abs(stats.totalSaldo))} icon={<DollarSign  className="w-5 h-5" />} color="red"    />
            <MetricCard title="Jumlah Accrual"      value={stats.jumlahAccrual.toString()}             icon={<FileText    className="w-5 h-5" />} color="purple" />
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
              <Card>
                <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
                <CardContent className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-3 w-1/3" />
                      <Skeleton className="h-8 w-full rounded-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="flex items-center justify-center py-16">
                  <div className="text-center space-y-3">
                    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-muted-foreground">Memuat data visualisasi...</p>
                  </div>
                </Card>
                <Card>
                  <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
                  <CardContent><Skeleton className="h-48 w-48 rounded-full mx-auto" /></CardContent>
                </Card>
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
                          <div key={index} className="space-y-1.5">
                            <div className="flex justify-between items-center text-sm">
                              <span className="font-medium text-foreground">{item.label}</span>
                              <span className="text-xs text-muted-foreground">
                                Selisih: {item.countSelisih} | Clear: {item.countClear}
                              </span>
                            </div>
                            <div className="relative h-8 bg-muted rounded-full overflow-hidden">
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
                    <Card className="flukt-card overflow-hidden">
                      <div className="h-1 bg-primary" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1">Total Records</p>
                        <p className="text-2xl font-bold text-foreground">{summary.fluktuasi.total.toLocaleString('id-ID')}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">akun-periode tersimpan</p>
                      </CardContent>
                    </Card>

                    <Card className="flukt-card overflow-hidden">
                      <div className="h-1 bg-violet-500" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1">Net Amount</p>
                        <p className="text-2xl font-bold text-foreground">{fmtCompact(summary.fluktuasi.netAmount)}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">total semua periode</p>
                      </CardContent>
                    </Card>

                    <Card className="flukt-card overflow-hidden">
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
                                  <div key={p.periode} className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className={cn('font-medium', isLast ? 'text-primary' : 'text-muted-foreground')}>
                                        {periodeToLabel(p.periode)}
                                      </span>
                                      <span className={cn('font-semibold', p.value < 0 ? 'text-green-600' : 'text-destructive')}>
                                        {p.value > 0 ? '+' : ''}{fmtCompact(p.value)}
                                      </span>
                                    </div>
                                    <div className="h-5 bg-muted rounded-full overflow-hidden">
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
              status={stats.totalAccrual > 0 ? (stats.totalRealisasi / stats.totalAccrual >= 0.8 ? 'normal' : 'warning') : 'normal'}
              percentage={stats.totalAccrual > 0 ? Math.round((stats.totalRealisasi / stats.totalAccrual) * 100) : 0}
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
