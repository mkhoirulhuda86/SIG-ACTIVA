'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BarChart3, FileSpreadsheet, RefreshCw } from 'lucide-react';
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
    setDetailActivity(activity);
    requestAnimationFrame(() => document.getElementById('detail-classification')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const openLegacyDetail = (activity: ActivityKey) => {
    if (!active || !dashboard?.period) return;
    const query = new URLSearchParams({ classification: active.key, activity, periode: dashboard.period });
    router.push(`/detail-akun-fluktuasi?${query.toString()}`);
  };

  const moveDetail = (direction: -1 | 1) => {
    if (!detailActivity) return;
    const activities: ActivityKey[] = ['mom', 'yoy', 'ytd'];
    const currentIndex = activities.indexOf(detailActivity);
    setDetailActivity(activities[(currentIndex + direction + activities.length) % activities.length]);
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
          <div className="mx-auto max-w-[1720px] space-y-3">
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
              <section className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
                <aside className="relative h-fit overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-b from-[#173a58] to-[#204d70] p-3.5 shadow-[0_14px_32px_rgba(24,49,73,0.13)] lg:sticky lg:top-0">
                  <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#3b8bd0] via-[#1e9a77] via-50% to-[#7858c9]" />
                  <div className="px-2 pb-3 pt-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#d9e7f1]">Klasifikasi</div>
                  <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                    {dashboard.classifications.map((classification) => {
                      const style = CLASS_STYLE[classification.key];
                      const selected = classification.key === active.key;
                      return (
                        <button
                          type="button"
                          key={classification.key}
                          onClick={() => { setActiveClassification(classification.key); setDetailActivity(null); }}
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
                            className={`group relative min-h-[286px] overflow-hidden bg-gradient-to-b ${style.panel} p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_999px_rgba(255,255,255,0.06)] ${index < 2 ? 'border-b border-[#dde6ed] lg:border-b-0 lg:border-r' : ''}`}
                          >
                            <span className={`absolute inset-x-0 top-0 h-1.5 ${style.accent}`} />
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-black text-[#27485f]">{meta.title}</span>
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
                                <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-3">
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

                                <div className="mt-4 grid grid-cols-2 gap-2">
                                  <div className="rounded-[13px] border border-slate-200/80 bg-gradient-to-b from-white/95 to-[#f7fafc] p-2.5 shadow-[0_4px_10px_rgba(29,57,83,0.04)]">
                                    <span className="block text-[7px] font-extrabold uppercase text-[#8192a2]">{meta.current}</span>
                                    <b className="mt-1 block text-[11px] text-[#17324a]">{fmtAmount(data.kpi.current)}</b>
                                  </div>
                                  <div className="rounded-[13px] border border-slate-200/80 bg-gradient-to-b from-white/95 to-[#f7fafc] p-2.5 shadow-[0_4px_10px_rgba(29,57,83,0.04)]">
                                    <span className="block text-[7px] font-extrabold uppercase text-[#8192a2]">{meta.previous}</span>
                                    <b className="mt-1 block text-[11px] text-[#17324a]">{fmtAmount(data.kpi.previous)}</b>
                                  </div>
                                </div>
                              </>
                            )}

                            <div className="mt-3 flex items-center justify-end gap-1 text-[9px] font-black text-[#245d87] opacity-70 transition group-hover:opacity-100">
                              Detail Analysis <ArrowRight className="h-3.5 w-3.5" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </article>

                  {detailActivity && (() => {
                    const detail = active.activities[detailActivity];
                    const total = detail.kpi;
                    return (
                      <section id="detail-classification" className="mt-4 scroll-mt-4 overflow-hidden rounded-[24px] border border-[#ccd9e3] bg-[#f7fafc] shadow-[0_14px_34px_rgba(24,49,73,0.09)]">
                        <header className="relative overflow-hidden bg-gradient-to-r from-[#153750] via-[#1b4868] to-[#245d83] px-5 py-4 text-white">
                          <div className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${CLASS_STYLE[active.key].header}`} />
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/65">Detail Analysis · {active.title}</div>
                              <h2 className="mt-1 text-base font-black tracking-tight">{detailActivity.toUpperCase()} — {detail.label}</h2>
                              <p className="mt-1 text-[10px] text-[#cfdeea]">Analisis per akun untuk periode {dashboard.periodLabel}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex overflow-hidden rounded-lg border border-white/20 bg-black/10">
                                <button type="button" onClick={() => moveDetail(-1)} aria-label="Aktivitas sebelumnya" className="border-r border-white/15 p-2 hover:bg-white/10"><ArrowLeft className="h-3.5 w-3.5" /></button>
                                <button type="button" onClick={() => moveDetail(1)} aria-label="Aktivitas berikutnya" className="p-2 hover:bg-white/10"><ArrowRight className="h-3.5 w-3.5" /></button>
                              </div>
                              <button type="button" onClick={() => openLegacyDetail(detailActivity)} className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-[10px] font-bold transition hover:bg-white/20">
                                Buka Detail Per Akun <ArrowRight className="ml-1 inline h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </header>

                        <div className="grid gap-2.5 border-b border-[#dbe4eb] bg-gradient-to-b from-[#eef4f8] to-[#f7fafc] p-3 sm:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: ACTIVITY_META[detailActivity].previous, value: fmtAmount(total.previous), percent: false },
                            { label: ACTIVITY_META[detailActivity].current, value: fmtAmount(total.current), percent: false },
                            { label: ACTIVITY_META[detailActivity].movement, value: fmtAmount(total.movement), percent: false },
                            { label: ACTIVITY_META[detailActivity].pct, value: fmtPercent(total.percent), percent: true },
                          ].map((item) => (
                            <div key={item.label} className="rounded-[14px] border border-white bg-gradient-to-b from-white to-[#f7fafc] px-4 py-3 shadow-[0_4px_12px_rgba(29,57,83,0.055)]">
                              <div className="text-[8px] font-black uppercase tracking-[0.1em] text-[#8292a1]">{item.label}</div>
                              <div className={`mt-1.5 truncate text-base font-black tracking-[-0.02em] ${item.percent ? percentTone(active.key, total.percent) : 'text-[#17324a]'}`}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[850px] text-xs">
                            <thead className="bg-[#1d4c6d] text-left text-[9px] uppercase tracking-[0.08em] text-white"><tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Previous</th><th className="px-4 py-3 text-right">Current</th><th className="px-4 py-3 text-right">Movement</th><th className="px-4 py-3 text-right">%</th></tr></thead>
                            <tbody className="divide-y divide-[#e5ebf0] bg-white">
                              {detail.rows.map((row) => <tr key={row.accountCode} className="transition-colors hover:bg-[#f4f8fb]"><td className="px-4 py-3 font-bold text-[#25465f]">{row.accountCode}</td><td className="px-4 py-3 text-slate-600">{row.description}</td><td className="px-4 py-3 text-right tabular-nums text-slate-800">{fmtAmount(row.previous)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-800">{fmtAmount(row.current)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-800">{fmtAmount(row.movement)}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${percentTone(active.key, row.percent)}`}>{fmtPercent(row.percent)}</td></tr>)}
                            </tbody>
                            <tfoot className="border-t-2 border-[#7890a2] bg-[#e8f0f5] font-black text-[#17324a]"><tr><td className="px-4 py-3.5 tracking-wide" colSpan={2}>TOTAL</td><td className="px-4 py-3.5 text-right tabular-nums">{fmtAmount(total.previous)}</td><td className="px-4 py-3.5 text-right tabular-nums">{fmtAmount(total.current)}</td><td className="px-4 py-3.5 text-right tabular-nums">{fmtAmount(total.movement)}</td><td className={`px-4 py-3.5 text-right tabular-nums ${percentTone(active.key, total.percent)}`}>{fmtPercent(total.percent)}</td></tr></tfoot>
                          </table>
                        </div>
                        <section className="border-t border-[#cbd8e2]">
                          <h3 className="bg-gradient-to-r from-[#173d5a] to-[#245d83] px-5 py-3 text-xs font-black tracking-wide text-white">Detail Penjelasan Reasons</h3>
                          <div className="divide-y divide-[#dce6ed] bg-[#eef5f8] px-4">
                            {detail.rows.filter((row) => row.reason).length > 0 ? detail.rows.filter((row) => row.reason).map((row) => (
                              <div key={row.accountCode} className="grid gap-1 py-3.5 md:grid-cols-[240px_minmax(0,1fr)] md:gap-5">
                                <div><div className="text-[10px] font-black text-[#214f72]">{row.accountCode}</div><div className="mt-0.5 text-[10px] leading-4 text-slate-500">{row.description}</div></div>
                                <p className="border-l-2 border-[#aec4d3] pl-3 text-xs leading-5 text-slate-700">{row.reason}</p>
                              </div>
                            )) : <p className="py-5 text-center text-xs text-slate-500">Belum ada Reasons yang tervalidasi untuk comparison ini.</p>}
                          </div>
                        </section>
                      </section>
                    );
                  })()}
                </div>
              </section>
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
