'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BarChart3, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

type ActivityKey = 'mom' | 'yoy' | 'ytd';
type ClassificationKey = 'beban-bunga' | 'pendapatan-lain' | 'pendapatan-bunga' | 'selisih-kurs';

type DetailRow = {
  accountCode: string;
  description: string;
  previous: number;
  current: number;
  movement: number;
  percent: number | null;
  reason: string;
  paretoContribution: number;
  paretoCumulative: number;
  paretoSelected: boolean;
};

type ActivityData = {
  key: ActivityKey;
  label: string;
  currentLabel: string;
  previousLabel: string;
  available: boolean;
  missingPeriods: string[];
  kpi: {
    previous: number;
    current: number;
    movement: number;
    percent: number | null;
  };
  rows: DetailRow[];
  pareto: DetailRow[];
};

type ClassificationData = {
  key: ClassificationKey;
  title: string;
  accountCount: number;
  activities: Record<ActivityKey, ActivityData>;
};

type DashboardResponse = {
  success: boolean;
  error?: string;
  data?: {
    period: string;
    periodLabel: string;
    periodOptions: string[];
    classifications: ClassificationData[];
    source: {
      importId: number;
      fileName: string;
      createdAt: string;
      rekapPeriod: string;
      qualityScore: number;
    } | null;
  };
};

const ACTIVITY_META: Record<ActivityKey, { title: string; pct: string; movement: string; current: string; previous: string }> = {
  mom: { title: 'MoM', pct: 'MoM %', movement: 'Movement MoM', current: 'Current', previous: 'Previous' },
  yoy: { title: 'YoY', pct: 'YoY %', movement: 'Movement YoY', current: 'Current', previous: 'Previous LY' },
  ytd: { title: 'YTD', pct: 'YTD %', movement: 'Movement YTD', current: 'Current YTD', previous: 'Previous YTD' },
};

const CLASS_STYLE: Record<ClassificationKey, {
  header: string;
  active: string;
  dot: string;
  title: string;
}> = {
  'beban-bunga': {
    header: 'from-[#1f6fb2] to-[#185c96]',
    active: 'from-[#2f80c5] to-[#1f659f]',
    dot: 'bg-[#3b8bd0]',
    title: 'text-[#185c96]',
  },
  'pendapatan-lain': {
    header: 'from-[#178567] to-[#116a52]',
    active: 'from-[#1c9271] to-[#14745a]',
    dot: 'bg-[#1e9a77]',
    title: 'text-[#116a52]',
  },
  'pendapatan-bunga': {
    header: 'from-[#c9861e] to-[#a96b10]',
    active: 'from-[#d1922d] to-[#b47617]',
    dot: 'bg-[#c98b2a]',
    title: 'text-[#a96b10]',
  },
  'selisih-kurs': {
    header: 'from-[#6f4bbd] to-[#58369d]',
    active: 'from-[#7a58c8] to-[#6142a9]',
    dot: 'bg-[#7858c9]',
    title: 'text-[#58369d]',
  },
};

const ACTIVITY_STYLE: Record<ActivityKey, { panel: string; accent: string; badge: string }> = {
  mom: {
    panel: 'from-[#f2f8ff] via-[#f9fcff] to-[#f7fbfe]',
    accent: 'bg-[#2f80d0]',
    badge: 'bg-[#2f80d0] border-[#2268aa]',
  },
  yoy: {
    panel: 'from-[#f2fbf7] via-[#f9fcfb] to-[#f7fbfa]',
    accent: 'bg-[#1d9a78]',
    badge: 'bg-[#1d9a78] border-[#14775d]',
  },
  ytd: {
    panel: 'from-[#f7f4ff] via-[#fbfaff] to-[#f9f8fe]',
    accent: 'bg-[#7657c8]',
    badge: 'bg-[#7657c8] border-[#5c3fa8]',
  },
};

const fmtAmount = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 0 });

const fmtPercent = (value: number | null) => value === null
  ? 'N/M'
  : `${value.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const percentTone = (classification: ClassificationKey, value: number | null) => {
  if (value === null || value === 0) return 'text-slate-500';
  if (classification === 'beban-bunga') return value > 0 ? 'text-[#cf4654]' : 'text-[#178565]';
  return value > 0 ? 'text-[#178565]' : 'text-[#cf4654]';
};

function LoadingState() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-[24px] border border-slate-200/80 bg-gradient-to-br from-slate-50 to-blue-50/70 shadow-sm">
      <div className="flex flex-col items-center gap-3 text-slate-600">
        <RefreshCw className="h-8 w-8 animate-spin text-[#245d87]" />
        <span className="text-sm font-semibold">Memuat Dashboard Resume...</span>
      </div>
    </div>
  );
}

export default function DashboardResumeFluktuasiPage() {
  const router = useRouter();
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse['data']>();
  const [activeClassification, setActiveClassification] = useState<ClassificationKey>('beban-bunga');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [detailActivity, setDetailActivity] = useState<ActivityKey | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const loadDashboard = useCallback(async (periode?: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const query = periode ? `?periode=${encodeURIComponent(periode)}` : '';
      const response = await fetch(`/api/fluktuasi/dashboard-resume${query}`, { cache: 'no-store' });
      const payload = await response.json() as DashboardResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Dashboard Resume tidak dapat dimuat');
      }
      if (requestId !== requestRef.current) return;
      setDashboard(payload.data);
      setSelectedPeriod(payload.data.period);
      if (!payload.data.classifications.some((item) => item.key === activeClassification)) {
        setActiveClassification(payload.data.classifications[0]?.key ?? 'beban-bunga');
      }
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof Error ? err.message : 'Dashboard Resume tidak dapat dimuat');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeClassification]);

  useEffect(() => {
    void loadDashboard();
    // Initial load only. Period changes call loadDashboard explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadFromRealtime = useCallback(() => {
    void loadDashboard(selectedPeriod || undefined);
  }, [loadDashboard, selectedPeriod]);
  useRealtimeUpdates(['fluktuasi'], reloadFromRealtime);

  const active = useMemo(
    () => dashboard?.classifications.find((item) => item.key === activeClassification) ?? dashboard?.classifications[0],
    [dashboard, activeClassification],
  );

  const openDetail = (activity: ActivityKey) => {
    setDetailSearch('');
    setDetailActivity(activity);
    requestAnimationFrame(() => document.getElementById('detail-classification')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const closeDetail = () => {
    setDetailActivity(null);
    setDetailSearch('');
    requestAnimationFrame(() => document.getElementById('dashboard-resume')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-[#edf2f6]">
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <Header
          title="Dashboard Resume Fluktuasi Laba Rugi"
          subtitle="Resume MoM, YoY, dan YTD dari data Fluktuasi OI/EXP"
          onMenuClick={() => setMobileSidebarOpen(true)}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-[#f8fafc] via-[#f1f5f8] to-[#eaf0f4] p-3 sm:p-4 xl:p-5">
          <div className="mx-auto max-w-[1860px] space-y-3">
            <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-[#eef4f8] to-[#f8fbfd] p-3 shadow-[0_7px_18px_rgba(32,58,82,0.05)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push('/fluktuasi-oi')}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#173d5a] bg-gradient-to-b from-[#214f72] to-[#173d5a] px-3 py-2 text-[11px] font-black tracking-wide text-white shadow-[0_7px_16px_rgba(23,61,90,0.18)] transition hover:-translate-y-0.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  REKAP
                </button>
                <div className="rounded-xl border border-[#214f72]/20 bg-[#214f72]/10 px-3 py-2 text-[10px] font-black tracking-[0.08em] text-[#214f72]">
                  DASHBOARD RESUME
                </div>
                {dashboard?.source && (
                  <div className="hidden text-[10px] text-slate-500 xl:block">
                    Rekap valid #{dashboard.source.importId} · {dashboard.source.fileName}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                Periode
                <select
                  value={selectedPeriod}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedPeriod(next);
                    setDetailActivity(null);
                    setDetailSearch('');
                    void loadDashboard(next);
                  }}
                  className="min-w-36 rounded-xl border border-slate-300 bg-white/90 px-3 py-2 text-xs font-bold normal-case tracking-normal text-slate-700 outline-none transition focus:border-[#245d87] focus:ring-2 focus:ring-[#245d87]/10"
                >
                  {(dashboard?.periodOptions ?? []).slice().reverse().map((period) => (
                    <option key={period} value={period}>{period}</option>
                  ))}
                </select>
              </label>
            </section>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            {loading && !dashboard ? <LoadingState /> : active && dashboard ? (
              detailActivity ? (() => {
                const detail = active.activities[detailActivity];
                const total = detail.kpi;
                const query = detailSearch.trim().toLocaleLowerCase('id-ID');
                const visibleRows = query
                  ? detail.rows.filter((row) => `${row.accountCode} ${row.description}`.toLocaleLowerCase('id-ID').includes(query))
                  : detail.rows;
                const reasonRows = detail.rows.filter((row) => row.reason);
                const kpiCards = [
                  { label: ACTIVITY_META[detailActivity].previous, value: fmtAmount(total.previous), tone: 'border-[#c8dff2] from-[#edf6fd] to-[#eaf3fb]', line: 'bg-[#2f80d0]', percent: false },
                  { label: ACTIVITY_META[detailActivity].current, value: fmtAmount(total.current), tone: 'border-[#c9e4d9] from-[#eef9f5] to-[#eaf6f1]', line: 'bg-[#1d9a78]', percent: false },
                  { label: ACTIVITY_META[detailActivity].movement, value: fmtAmount(total.movement), tone: 'border-[#ecd5ab] from-[#fff7ea] to-[#fff3df]', line: 'bg-[#c88a2b]', percent: false },
                  { label: ACTIVITY_META[detailActivity].pct, value: fmtPercent(total.percent), tone: 'border-[#d9cdef] from-[#f5f0fd] to-[#f1ebfb]', line: 'bg-[#7657c8]', percent: true },
                ];

                return (
                  <section id="detail-classification" className="scroll-mt-4">
                    <div className="mb-3 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0">
                        <h2 className="text-lg font-black tracking-[-0.02em] text-[#1d405e]">Detail {active.title}</h2>
                      </div>
                      <button
                        type="button"
                        onClick={closeDetail}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-[#173d5a] bg-gradient-to-b from-[#214f72] to-[#173d5a] px-3 py-2.5 text-[9px] font-black uppercase tracking-[0.04em] text-white shadow-[0_7px_16px_rgba(23,61,90,0.18)] transition hover:-translate-y-0.5 hover:from-[#2a5d83] hover:to-[#1b4767]"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Dashboard Resume
                      </button>
                    </div>

                    <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                      {dashboard.classifications.map((classification) => {
                        const selected = classification.key === active.key;
                        const style = CLASS_STYLE[classification.key];
                        return (
                          <button
                            type="button"
                            key={classification.key}
                            onClick={() => { setActiveClassification(classification.key); setDetailSearch(''); }}
                            className={`shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-extrabold transition hover:-translate-y-0.5 ${selected
                              ? `border-transparent bg-gradient-to-r ${style.active} text-white shadow-[0_6px_14px_rgba(36,93,135,0.16)]`
                              : 'border-[#dce5ec] bg-white text-[#557087] hover:bg-[#f6f8fb]'
                            }`}
                          >
                            {classification.title}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                      {(['mom', 'yoy', 'ytd'] as ActivityKey[]).map((activity) => (
                        <button
                          type="button"
                          key={activity}
                          onClick={() => { setDetailActivity(activity); setDetailSearch(''); }}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-extrabold transition hover:-translate-y-0.5 ${activity === detailActivity
                            ? 'border-[#245d87] bg-[#245d87] text-white shadow-[0_6px_14px_rgba(36,93,135,0.18)]'
                            : 'border-[#dce5ec] bg-white text-[#557087] hover:bg-[#f6f8fb]'
                          }`}
                        >
                          {ACTIVITY_META[activity].title}
                        </button>
                      ))}
                    </div>

                    <div className="mb-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                      {kpiCards.map((item) => (
                        <div
                          key={item.label}
                          className={`relative overflow-hidden rounded-[16px] border bg-gradient-to-b px-4 py-3.5 shadow-[0_7px_18px_rgba(32,58,82,0.06)] ${item.tone}`}
                        >
                          <span className={`absolute inset-x-0 top-0 h-1 ${item.line}`} />
                          <div className="text-[8px] font-black uppercase tracking-[0.03em] text-[#6f8295]">{item.label}</div>
                          <div className={`mt-1.5 truncate text-lg font-black tracking-[-0.015em] ${item.percent ? percentTone(active.key, total.percent) : 'text-[#17324a]'}`}>
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <section className="overflow-hidden rounded-[20px] border border-[#e3e9ef] bg-white/95 shadow-[0_8px_24px_rgba(24,49,73,0.06)]">
                      <div className="flex flex-col gap-3 border-b border-[#d6e0e8] bg-gradient-to-b from-[#edf3f8] to-[#e6eef5] px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-black text-[#183d5a]">Detail Account-Description</h3>
                        </div>
                        <label className="relative block w-full sm:w-72">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input
                            value={detailSearch}
                            onChange={(event) => setDetailSearch(event.target.value)}
                            placeholder="Cari Account / Description..."
                            className="h-[34px] w-full rounded-[10px] border border-[#bfcfdd] bg-[#f8fbfd] pl-9 pr-3 text-[9px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#6f95b5] focus:ring-2 focus:ring-[#2f80d0]/10"
                          />
                        </label>
                      </div>

                      <div className="max-h-[480px] overflow-auto">
                        <table className="w-full min-w-[850px] border-collapse text-[10px]">
                          <thead className="sticky top-0 z-10 bg-gradient-to-b from-[#2a5c83] to-[#214d70] text-white">
                            <tr>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-left text-[8px] font-black uppercase tracking-[0.06em]">Account</th>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-left text-[8px] font-black uppercase tracking-[0.06em]">Description</th>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.06em]">Previous</th>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.06em]">Current</th>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.06em]">Movement</th>
                              <th className="border-b border-[#183d5a] px-3 py-2.5 text-right text-[8px] font-black uppercase tracking-[0.06em]">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleRows.map((row, index) => (
                              <tr key={row.accountCode} className={`${index % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'} transition-colors hover:bg-[#eef5fa]`}>
                                <td className="border-b border-[#eef2f5] px-3 py-2.5 text-left font-black text-[#244864]">{row.accountCode}</td>
                                <td className="border-b border-[#eef2f5] px-3 py-2.5 text-left text-slate-600">
                                  <span>{row.description}</span>
                                  {row.paretoSelected && (
                                    <span className="ml-1.5 inline-flex rounded-full border border-[#e5c77b] bg-[#fff3da] px-1.5 py-0.5 text-[7px] font-black uppercase text-[#8c6118]">Pareto</span>
                                  )}
                                </td>
                                <td className="border-b border-[#eef2f5] px-3 py-2.5 text-right tabular-nums text-slate-800">{fmtAmount(row.previous)}</td>
                                <td className="border-b border-[#eef2f5] px-3 py-2.5 text-right tabular-nums text-slate-800">{fmtAmount(row.current)}</td>
                                <td className="border-b border-[#eef2f5] px-3 py-2.5 text-right tabular-nums text-slate-800">{fmtAmount(row.movement)}</td>
                                <td className={`border-b border-[#eef2f5] px-3 py-2.5 text-right font-black tabular-nums ${percentTone(active.key, row.percent)}`}>{fmtPercent(row.percent)}</td>
                              </tr>
                            ))}
                            {visibleRows.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">Account atau Description tidak ditemukan.</td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-[#b8cad8] bg-[#edf4f9] font-black text-[#17324a]">
                              <td className="px-3 py-3 text-left" colSpan={2}>TOTAL</td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmtAmount(total.previous)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmtAmount(total.current)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{fmtAmount(total.movement)}</td>
                              <td className={`px-3 py-3 text-right tabular-nums ${percentTone(active.key, total.percent)}`}>{fmtPercent(total.percent)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </section>

                    <section className="mt-3.5 overflow-hidden rounded-[20px] border border-[#cfdae4] bg-[#eaf1f6] shadow-[0_8px_24px_rgba(24,49,73,0.06)]">
                      <div className="border-b border-[#12334d] bg-gradient-to-b from-[#173b59] to-[#12334d] px-4 py-3.5 text-white">
                        <h3 className="text-sm font-black">Detail Penjelasan Reasons</h3>
                        <p className="mt-0.5 text-[9px] text-[#c8d8e5]">Teks ditampilkan apa adanya dari AA / AD / AG sesuai activity dan Account-Description.</p>
                      </div>
                      <div>
                        {reasonRows.length > 0 ? reasonRows.map((row, index) => (
                          <div key={row.accountCode} className="grid border-b border-[#e3e9ef] last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)]">
                            <div className="border-b border-[#cad7e2] bg-gradient-to-b from-[#dfeaf3] to-[#e8f0f6] px-4 py-3.5 md:border-b-0 md:border-r">
                              <div className="text-[10px] font-black text-[#244864]">{row.accountCode}</div>
                              <div className="mt-1 text-[9px] leading-4 text-[#5f7386]">{row.description}</div>
                            </div>
                            <div className={`px-4 py-3.5 ${index % 2 === 1 ? 'bg-[#e8f1f6]' : 'bg-[#edf4f8]'}`}>
                              <p className={`rounded-xl border border-[#c7d7e3] px-3 py-2.5 text-[10px] leading-[1.62] text-[#2f4b62] shadow-[0_2px_8px_rgba(34,55,75,0.035)] ${index % 2 === 1 ? 'bg-[#dfeaf2]' : 'bg-[#e4eef5]'}`}>
                                {row.reason}
                              </p>
                            </div>
                          </div>
                        )) : (
                          <p className="px-4 py-5 text-[9px] text-[#94a1ad]">Belum ada Reasons yang tervalidasi untuk comparison ini.</p>
                        )}
                      </div>
                    </section>
                  </section>
                );
              })() : (
                <section id="dashboard-resume" className="scroll-mt-4 grid gap-[18px] lg:grid-cols-[250px_minmax(0,1fr)]">
                  <aside className="relative h-fit overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-b from-[#173a58] to-[#204d70] p-3.5 shadow-[0_14px_32px_rgba(24,49,73,0.13)] lg:sticky lg:top-0">
                    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#3b8bd0] via-[#1e9a77] via-50% to-[#7858c9]" />
                    <div className="px-2 pb-3 pt-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#d9e7f1]">Klasifikasi</div>
                    <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                      {dashboard.classifications.map((classification) => {
                        const style = CLASS_STYLE[classification.key];
                        const selected = classification.key === active.key;
                        return (
                          <button
                            type="button"
                            key={classification.key}
                            onClick={() => { setActiveClassification(classification.key); setDetailSearch(''); }}
                            className={`grid min-w-[205px] grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[13px] border px-3 py-3 text-left transition lg:min-w-0 ${selected
                              ? `border-white/30 bg-gradient-to-b ${style.active} text-white shadow-[0_8px_20px_rgba(10,31,49,0.24)]`
                              : 'border-white/10 bg-white/[0.055] text-[#d8e5ee] hover:translate-x-0.5 hover:bg-white/10'
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                            <span className="text-[10px] font-extrabold leading-4">{classification.title}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[8px] ${selected ? 'bg-white/15 text-white' : 'bg-white/[0.07] text-[#9fb4c5]'}`}>
                              {classification.accountCount}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </aside>

                  <div className="min-w-0">
                    <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
                      <div className={`text-xs font-black ${CLASS_STYLE[active.key].title}`}>{active.title}</div>
                      <div className="text-[8px] font-medium text-[#8294a4]">{dashboard.periodLabel}</div>
                    </div>

                    <article className="overflow-hidden rounded-[24px] border border-[#d5e0e8] bg-gradient-to-b from-[#fdfefe] to-[#f5f8fb] shadow-[0_14px_34px_rgba(24,49,73,0.09)]">
                      <header className={`flex flex-col gap-2 border-b border-white/20 bg-gradient-to-b ${CLASS_STYLE[active.key].header} px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between`}>
                        <div>
                          <div className="text-[13px] font-black tracking-wide">{active.title}</div>
                          <div className="mt-1 text-[9px] text-white/75">Aggregation Detail Account-Description · {active.accountCount} akun</div>
                        </div>
                        <div className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[9px] font-bold">
                          {dashboard.periodLabel}
                        </div>
                      </header>

                      <div className="grid lg:grid-cols-3">
                        {(['mom', 'yoy', 'ytd'] as ActivityKey[]).map((activity, index) => {
                          const data = active.activities[activity];
                          const meta = ACTIVITY_META[activity];
                          const style = ACTIVITY_STYLE[activity];
                          return (
                            <button
                              type="button"
                              key={activity}
                              onClick={() => openDetail(activity)}
                              className={`group relative min-h-[226px] overflow-hidden bg-gradient-to-b ${style.panel} p-[18px] text-left transition hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.06)] ${index < 2 ? 'border-b border-[#dde6ed] lg:border-b-0 lg:border-r' : ''}`}
                            >
                              <span className={`absolute inset-x-0 top-0 h-1.5 ${style.accent}`} />
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-black text-[#27485f]">{meta.title}</span>
                                <span className={`rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-wide text-white ${style.badge}`}>
                                  REKAP · {meta.title}
                                </span>
                              </div>
                              <div className="mt-1 text-[9px] text-slate-400">{data.label}</div>

                              {!data.available ? (
                                <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs font-semibold text-amber-800">
                                  Data pembanding belum lengkap: {data.missingPeriods.join(', ')}
                                </div>
                              ) : (
                                <>
                                  <div className="mt-2.5 grid grid-cols-[1fr_.9fr] items-end gap-3">
                                    <div>
                                      <div className="text-[8px] font-extrabold uppercase tracking-[0.08em] text-[#8292a1]">{meta.pct}</div>
                                      <div className={`mt-1 text-[30px] font-black leading-none tracking-[-0.04em] ${percentTone(active.key, data.kpi.percent)}`}>
                                        {fmtPercent(data.kpi.percent)}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-[8px] font-extrabold uppercase tracking-[0.08em] text-[#8292a1]">{meta.movement}</div>
                                      <div className="mt-1 text-base font-black text-[#17324a]">{fmtAmount(data.kpi.movement)}</div>
                                    </div>
                                  </div>

                                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                                    <div className="rounded-[13px] border border-slate-200/80 bg-gradient-to-b from-white/95 to-[#f7fafc] p-2.5 shadow-[0_4px_10px_rgba(29,57,83,0.04)]">
                                      <span className="block text-[7px] font-extrabold uppercase text-[#8192a2]">{meta.current}</span>
                                      <b className="mt-1 block text-[10px] text-[#17324a]">{fmtAmount(data.kpi.current)}</b>
                                    </div>
                                    <div className="rounded-[13px] border border-slate-200/80 bg-gradient-to-b from-white/95 to-[#f7fafc] p-2.5 shadow-[0_4px_10px_rgba(29,57,83,0.04)]">
                                      <span className="block text-[7px] font-extrabold uppercase text-[#8192a2]">{meta.previous}</span>
                                      <b className="mt-1 block text-[10px] text-[#17324a]">{fmtAmount(data.kpi.previous)}</b>
                                    </div>
                                  </div>
                                </>
                              )}

                              <div className="mt-2 flex items-center justify-end gap-1 text-[9px] font-black text-[#245d87] opacity-70 transition group-hover:opacity-100">
                                Detail Analysis <ArrowRight className="h-3.5 w-3.5" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  </div>
                </section>
              )
            ) : !loading ? (
              <div className="grid min-h-[360px] place-items-center rounded-[24px] border border-slate-200 bg-slate-50/80 text-center">
                <div>
                  <BarChart3 className="mx-auto h-9 w-9 text-slate-400" />
                  <div className="mt-3 text-sm font-bold text-slate-600">Belum ada data Dashboard Resume.</div>
                </div>
              </div>
            ) : <LoadingState />}
          </div>
        </main>
      </div>
    </div>
  );
}
