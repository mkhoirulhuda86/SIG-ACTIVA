'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import dynamic from 'next/dynamic';
import { Activity, TrendingUp } from 'lucide-react';
import { gsap } from 'gsap';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
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
    <div className="flex h-screen bg-[#f0f4fa] overflow-hidden">
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
        <div ref={skeletonRef} className="flex-1 overflow-hidden p-3 space-y-3">
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

const TOP_ACCOUNTS_PER_FRAME = 5;

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OverviewFluktuasiPage() {
  const [records, setRecords]                   = useState<ParsedRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  const [compMode,       setCompMode]       = useState<'mom' | 'yoy' | 'ytd'>('yoy');
  const [compPeriodeRaw, setCompPeriodeRaw] = useState<string>('');

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    // Use rekap-amounts which reads from FluktuasiImport.rekapSheetData — covers ALL accounts
    // including those that only appear in the REKAP sheet (not individual account sheets).
    fetch('/api/fluktuasi/rekap-amounts')
      .then(r => r.json())
      .then((data: { success: boolean; data: AkunPeriodeRecord[] }) => {
        if (data.success && Array.isArray(data.data)) {
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
        frames: FRAME_DEFS.map(frame => ({
          key: frame.key,
          title: frame.title,
          rows: [] as { accountCode: string; name: string; prev: number; curr: number }[],
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

    const frameMaps = FRAME_DEFS.map(frame => ({
      ...frame,
      mapA: new Map<string, number>(),
      mapB: new Map<string, number>(),
      allAccounts: new Set<string>(frame.accounts),
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
      const allRows = [...frame.allAccounts].map(accountCode => ({
        accountCode,
        name: ACCOUNT_NAMES[accountCode] ?? accountCode,
        prev: frame.mapB.get(accountCode) ?? 0,
        curr: frame.mapA.get(accountCode) ?? 0,
      }));

      const rows = allRows
        .filter(row => row.prev !== 0 || row.curr !== 0)
        .sort((a, b) => Math.max(Math.abs(b.prev), Math.abs(b.curr)) - Math.max(Math.abs(a.prev), Math.abs(a.curr)))
        .slice(0, TOP_ACCOUNTS_PER_FRAME);

      return {
        key: frame.key,
        title: frame.title,
        rows,
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
        <div ref={contentRef} className="flex-1 overflow-hidden p-3 space-y-3">

          {/* 4 Frames: masing-masing 1 histogram gabungan */}
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
                  <Card key={frame.key} className="anim-card border border-slate-100 shadow-sm bg-slate-50/60">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-xs font-semibold uppercase tracking-wide text-red-600">{frame.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-2">
                      {frame.rows.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-10">Tidak ada data akun pada periode ini</p>
                      ) : (
                        <div>
                          <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={frame.rows} margin={{ top: 12, right: 12, left: 0, bottom: 70 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis
                                  dataKey="accountCode"
                                  interval={0}
                                  angle={0}
                                  textAnchor="end"
                                  height={44}
                                  tick={{ fontSize: 10, fill: '#64748b' }}
                                />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={fmtCompact} />
                                <Tooltip
                                  formatter={(value) => {
                                    const normalized = typeof value === 'number' ? value : Number(value ?? 0);
                                    return fmtCompact(Number.isFinite(normalized) ? normalized : 0);
                                  }}
                                  labelFormatter={(accountCode: string) => `${accountCode} - ${ACCOUNT_NAMES[accountCode] ?? accountCode}`}
                                />
                                <Legend />
                                <Bar dataKey="prev" name={accountFramesByMode.labelB || accountFramesByMode.tagB} fill="#2563eb" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="curr" name={accountFramesByMode.labelA || accountFramesByMode.tagA} fill="#16a34a" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
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
    </div>
  );
}
