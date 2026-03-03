'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, CheckCircle, DollarSign, FileText, Package, CreditCard, Clock, BarChart2, Minus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { gsap } from 'gsap';
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
  const contentRef = useRef<HTMLDivElement>(null);

  /* ── GSAP: animate grid sections in on load ──────────────── */
  useEffect(() => {
    if (!contentRef.current) return;
    const sections = contentRef.current.querySelectorAll('.dashboard-section');
    if (sections.length === 0) return;
    gsap.fromTo(
      sections,
      { opacity: 0, y: 32 },
      {
        opacity: 1, y: 0,
        duration: 0.65,
        ease: 'power3.out',
        stagger: 0.12,
        delay: 0.1,
      }
    );
  // trigger once after mount
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
    // Accrual stats card needs full accrual recalc
    if (event === 'accrual') {
      fetchDashboardStats();
    }
    // Summary (charts + all cards) always re-fetched on any event
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

        // Mirror calculateAccrualAmount from monitoring-accrual page:
        // For non-manual: only count periodes that are past-due OR have effective realisasi
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

        // Raw realisasi: plain sum per item (mirrors calculateActualRealisasi on monitoring page)
        // Used for both Total Realisasi and Total Saldo Accrual
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
          // Total Realisasi = raw sum of all realisasi (matches Realisasi column in monitoring table)
          totalRealisasiSum += rawRealisasiItem;
          // Total Saldo = saldo awal + accrual - raw realisasi (matches "Saldo" metric card on monitoring page)
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
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
  }, []);

  // Memoized chart data
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
      { label: 'Active', value: summary.prepaid.status.active, color: '#2563eb' },
      { label: 'Cleared', value: summary.prepaid.status.cleared, color: '#059669' },
      { label: 'Pending', value: summary.prepaid.status.pending, color: '#f59e0b' },
    ];
  }, [summary]);

  const accrualDonutData = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Active', value: summary.accrual.status.active, color: '#dc2626' },
      { label: 'Cleared', value: summary.accrual.status.cleared, color: '#059669' },
      { label: 'Pending', value: summary.accrual.status.pending, color: '#f59e0b' },
    ];
  }, [summary]);

  const topAccrualVendorsData = useMemo(() => {
    if (!summary) return [];
    return summary.accrual.topVendors.map(v => ({
      label: v.label,
      value: v.value,
    }));
  }, [summary]);

  const topAccrualByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.accrual.topByKlasifikasi.map(v => ({
      label: v.label,
      value: v.value,
    }));
  }, [summary]);

  const topPrepaidByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.prepaid.topByKlasifikasi.map(v => ({
      label: v.label,
      value: v.value,
    }));
  }, [summary]);

  const topPrepaidByAmountData = useMemo(() => {
    if (!summary) return [];
    return summary.prepaid.topPrepaidByAmount.map(v => ({
      label: v.label,
      value: v.value,
    }));
  }, [summary]);

  const fluktuasiByKlasifikasiData = useMemo(() => {
    if (!summary) return [];
    return summary.fluktuasi.topByKlasifikasi.map(v => ({
      label: v.label,
      value: v.value,
    }));
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

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar - Always rendered, controlled by transform */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-gray-50 lg:ml-64">
        {/* Header */}
        <Header
          title="Dashboard"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          subtitle="Ringkasan aktivitas dan monitoring accrual"
        />

        {/* Content Area */}
        <div ref={contentRef} className="p-4 sm:p-6 md:p-8 bg-gray-50">
          {/* Metric Cards */}
          <div className="dashboard-section grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
            <div className="animate-fadeIn delay-100">
              <MetricCard
                title="Total Accrual"
                value={formatCurrency(stats.totalAccrual)}
                icon={<TrendingUp className="w-5 h-5 sm:w-6 sm:h-6" />}
                color="blue"
              />
            </div>
            <div className="animate-fadeIn delay-200">
              <MetricCard
                title="Total Realisasi"
                value={formatCurrency(stats.totalRealisasi)}
                icon={<CheckCircle className="w-5 h-5 sm:w-6 sm:h-6" />}
                color="green"
              />
            </div>
            <div className="animate-fadeIn delay-300">
              <MetricCard
                title="Total Saldo Accrual"
                value={formatCurrency(stats.totalSaldo)}
                icon={<DollarSign className="w-5 h-5 sm:w-6 sm:h-6" />}
                color="red"
              />
            </div>
            <div className="animate-fadeIn delay-400">
              <MetricCard
                title="Jumlah Accrual"
                value={stats.jumlahAccrual.toString()}
                icon={<FileText className="w-5 h-5 sm:w-6 sm:h-6" />}
                color="purple"
              />
            </div>
          </div>

          {/* Additional Overview Cards */}
          {summary && (
            <div className="dashboard-section grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
              <div className="animate-fadeIn delay-100">
                <MetricCard
                  title="Total Material"
                  value={summary.material.total.toString()}
                  icon={<Package className="w-5 h-5 sm:w-6 sm:h-6" />}
                  color="indigo"
                />
              </div>
              <div className="animate-fadeIn delay-200">
                <MetricCard
                  title="Total Prepaid"
                  value={summary.prepaid.total.toString()}
                  icon={<CreditCard className="w-5 h-5 sm:w-6 sm:h-6" />}
                  color="teal"
                />
              </div>
              <div className="animate-fadeIn delay-300">
                <MetricCard
                  title="Saldo Prepaid"
                  value={formatCurrency(summary.prepaid.financial.remaining)}
                  icon={<Clock className="w-5 h-5 sm:w-6 sm:h-6" />}
                  color="orange"
                />
              </div>
            </div>
          )}

          {/* Charts Section */}
          {!loading && summary && (
            <>
              {/* Material Chart - Full Width */}
              <div className="mb-4 sm:mb-6 md:mb-8">
                <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Top 5 Material per Plant (Berdasarkan Selisih)</h3>
                  <div className="space-y-4">
                    {materialChartData.map((item, index) => {
                      const total = item.countSelisih + item.countClear;
                      const selisihPercent = total > 0 ? (item.countSelisih / total) * 100 : 0;
                      const clearPercent = total > 0 ? (item.countClear / total) * 100 : 0;
                      
                      return (
                        <div key={index} className="space-y-2">
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-medium text-gray-700">{item.label}</span>
                            <span className="text-xs text-gray-500">
                              Selisih: {item.countSelisih} | Clear: {item.countClear}
                            </span>
                          </div>
                          <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className="absolute left-0 top-0 h-full bg-red-500 transition-all duration-300"
                              style={{ width: `${selisihPercent}%` }}
                            >
                              {selisihPercent > 15 && (
                                <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                                  {selisihPercent.toFixed(0)}%
                                </span>
                              )}
                            </div>
                            <div 
                              className="absolute right-0 top-0 h-full bg-green-500 transition-all duration-300"
                              style={{ width: `${clearPercent}%` }}
                            >
                              {clearPercent > 15 && (
                                <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                                  {clearPercent.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>Total Selisih: {formatCurrency(item.value)}</span>
                            <span>Total: {total} items</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200 flex gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded"></div>
                      <span className="text-gray-600">Ada Selisih</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded"></div>
                      <span className="text-gray-600">Clear</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Prepaid & Accrual Status Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
                <DonutChart
                  data={prepaidDonutData}
                  title="Status Prepaid"
                  centerText={summary.prepaid.total.toString()}
                  centerSubtext="Total Prepaid"
                />
                
                <DonutChart
                  data={accrualDonutData}
                  title="Status Accrual"
                  centerText={summary.accrual.total.toString()}
                  centerSubtext="Saldo"
                />
              </div>

              {/* Top Charts by Classification */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
                <SimpleBarChart
                  data={topAccrualByKlasifikasiData}
                  title="Top 5 Accrual (Berdasarkan Klasifikasi)"
                  color="#dc2626"
                />
                
                <SimpleBarChart
                  data={topPrepaidByKlasifikasiData}
                  title="Top 5 Prepaid (Berdasarkan Klasifikasi)"
                  color="#059669"
                />
              </div>

              {/* Fluktuasi OI/EXP Section */}
              {summary.fluktuasi.total > 0 && (
                <>
                  {/* Fluktuasi Metric Cards */}
                  <div className="mb-3 sm:mb-4">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <BarChart2 className="w-5 h-5 text-blue-600" />
                      Ringkasan Fluktuasi OI/EXP
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
                      <p className="text-xs sm:text-sm text-gray-500 mb-1">Total Records</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-800">{summary.fluktuasi.total.toLocaleString('id-ID')}</p>
                      <p className="text-xs text-gray-400 mt-1">akun-periode tersimpan</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
                      <p className="text-xs sm:text-sm text-gray-500 mb-1">Net Amount</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-800">{fmtCompact(summary.fluktuasi.netAmount)}</p>
                      <p className="text-xs text-gray-400 mt-1">total semua periode</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
                      <p className="text-xs sm:text-sm text-gray-500 mb-1">Perubahan MoM</p>
                      <div className="flex items-center gap-2 mt-1">
                        {summary.fluktuasi.momChange === 0 ? (
                          <Minus className="w-5 h-5 text-gray-400" />
                        ) : summary.fluktuasi.momChange > 0 ? (
                          <TrendingUp className="w-5 h-5 text-red-500" />
                        ) : (
                          <TrendingDown className="w-5 h-5 text-green-600" />
                        )}
                        <p className={`text-xl sm:text-2xl font-bold ${
                          summary.fluktuasi.momChange === 0 ? 'text-gray-500'
                          : summary.fluktuasi.momChange > 0 ? 'text-red-600'
                          : 'text-green-600'
                        }`}>
                          {summary.fluktuasi.momChange > 0 ? '+' : ''}{fmtCompact(summary.fluktuasi.momChange)}
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {summary.fluktuasi.momPct !== 0
                          ? `${summary.fluktuasi.momPct > 0 ? '+' : ''}${summary.fluktuasi.momPct.toFixed(1)}% vs bulan lalu`
                          : 'vs bulan lalu'}
                      </p>
                    </div>
                  </div>

                  {/* Fluktuasi Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
                    {/* Top 5 Klasifikasi Bar */}
                    <SimpleBarChart
                      data={fluktuasiByKlasifikasiData}
                      title="Top 5 Fluktuasi (Berdasarkan Klasifikasi)"
                      color="#7c3aed"
                    />

                    {/* Last 6 periods trend */}
                    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
                      <h3 className="text-sm sm:text-base font-semibold text-gray-900 mb-4">Trend 6 Periode Terakhir</h3>
                      {summary.fluktuasi.last6Periodes.length > 0 ? (
                        <div className="space-y-3">
                          {(() => {
                            const maxAbs = Math.max(...summary.fluktuasi.last6Periodes.map(p => Math.abs(p.value)), 1);
                            return summary.fluktuasi.last6Periodes.map((p, i) => {
                              const pct = Math.abs(p.value) / maxAbs * 100;
                              const isLast = i === summary.fluktuasi.last6Periodes.length - 1;
                              return (
                                <div key={p.periode} className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className={`font-medium ${isLast ? 'text-blue-600' : 'text-gray-600'}`}>
                                      {periodeToLabel(p.periode)}
                                    </span>
                                    <span className={`font-semibold ${p.value < 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {p.value > 0 ? '+' : ''}{fmtCompact(p.value)}
                                    </span>
                                  </div>
                                  <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        isLast ? 'bg-blue-500' : p.value < 0 ? 'bg-green-400' : 'bg-red-400'
                                      }`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 text-center py-4">Belum ada data periode</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Status Summary */}
              <div className="grid grid-cols-1 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
                <StatusCard
                  title="Ringkasan Status"
                  items={[
                    {
                      label: 'Prepaid Active',
                      count: summary.prepaid.status.active,
                      status: 'success',
                    },
                    {
                      label: 'Prepaid Pending',
                      count: summary.prepaid.status.pending,
                      status: 'warning',
                    },
                    {
                      label: 'Accrual Active',
                      count: summary.accrual.status.active,
                      status: 'error',
                    },
                    {
                      label: 'Accrual Pending',
                      count: summary.accrual.status.pending,
                      status: 'pending',
                    },
                  ]}
                />
              </div>
            </>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-8 sm:py-12">
              <div className="text-center">
                <div className="inline-block w-6 h-6 sm:w-8 sm:h-8 border-3 sm:border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3 sm:mb-4"></div>
                <p className="text-sm sm:text-base text-gray-600">Memuat data visualisasi...</p>
              </div>
            </div>
          )}

          {/* Rekonsiliasi Cards */}
          <div className="dashboard-section grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
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
