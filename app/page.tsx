'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { TrendingUp, CheckCircle, DollarSign, FileText, Package, CreditCard, Clock } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MetricCard from './components/MetricCard';
import RekonsiliasiCard from './components/RekonsiliasiCard';
import SimpleBarChart from './components/SimpleBarChart';
import DonutChart from './components/DonutChart';
import StatusCard from './components/StatusCard';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

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
}

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalAccrual: 0,
    totalRealisasi: 0,
    totalSaldo: 0,
    jumlahAccrual: 0,
  });
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    fetchDashboardStats();
    fetchDashboardSummary();
  }, []);

  // Realtime: re-fetch whenever any accrual/realisasi data changes
  useRealtimeUpdates(['accrual'], () => {
    fetchDashboardStats();
    fetchDashboardSummary();
  });

  const fetchDashboardStats = useCallback(async () => {
    try {
      const response = await fetch('/api/accrual');
      if (response.ok) {
        const accruals = await response.json();
        // Saldo = saldo awal + total accrual - realisasi; total accrual = sum(amountAccrual) per periode
        let totalAccrualSum = 0;
        let totalRealisasiSum = 0;
        let totalSaldoSum = 0;
        accruals.forEach((item: any) => {
          const saldoAwal = item.saldoAwal != null ? Number(item.saldoAwal) : Math.abs(item.totalAmount || 0);
          const totalAccrualItem = item.periodes?.reduce((s: number, p: any) => s + Math.abs(p.amountAccrual || 0), 0) || 0;
          const totalRealisasiItem = item.periodes?.reduce((s: number, p: any) => s + (p.totalRealisasi || 0), 0) || 0;
          totalAccrualSum += totalAccrualItem;
          totalRealisasiSum += totalRealisasiItem;
          totalSaldoSum += saldoAwal + totalAccrualItem - totalRealisasiItem;
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
    return `Rp ${amount.toLocaleString('id-ID')}`;
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
        <div className="p-3 sm:p-4 md:p-6 lg:p-8 bg-gray-50">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
            <div className="animate-fadeIn delay-100">
              <MetricCard
                title="Saldo"
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
                title="Total Saldo"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-6 animate-fadeIn delay-300">
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
