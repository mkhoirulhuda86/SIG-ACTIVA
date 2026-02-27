'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────
type AkunPeriodeRecord = {
  id?: number;
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi: string;
  remark: string;
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

const fmtFull = (n: number): string =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);

const periodeToLabel = (p: string): string => {
  const [yr, mo] = p.split('.');
  const m = parseInt(mo) - 1;
  return `${MONTHS_ID[m] ?? mo} ${yr}`;
};

const PALETTE = [
  '#22d3ee','#34d399','#f59e0b','#f87171','#a78bfa',
  '#fb923c','#38bdf8','#4ade80','#e879f9','#facc15',
  '#818cf8','#fb7185',
];

// ─── Semi-circular gauge ──────────────────────────────────────────────────────
function SemiGauge({
  value, max, label, amount, color,
}: { value: number; max: number; label: string; amount: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const R = 40;
  const cx = 55, cy = 55;

  const startX = cx - R;
  const endX   = cx + R;
  const bgPath = `M ${startX} ${cy} A ${R} ${R} 0 0 1 ${endX} ${cy}`;

  const angle  = Math.PI * pct;
  const fgEndX = cx + R * Math.cos(Math.PI - angle);
  const fgEndY = cy - R * Math.sin(Math.PI - angle);
  const largeArc = pct > 0.5 ? 1 : 0;
  const fgPath = pct < 0.01
    ? ''
    : pct >= 0.999
      ? `M ${startX} ${cy} A ${R} ${R} 0 1 1 ${endX - 0.01} ${cy}`
      : `M ${startX} ${cy} A ${R} ${R} 0 ${largeArc} 1 ${fgEndX} ${fgEndY}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 110 65" style={{ width: 120, height: 72, overflow: 'visible' }}>
        {/* Background track */}
        <path d={bgPath} fill="none" stroke="#0f2845" strokeWidth={11} strokeLinecap="round" />
        {/* Foreground gauge */}
        {fgPath && (
          <path d={fgPath} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
        )}
        {/* Value label */}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize={10} fontWeight="800"
          style={{ letterSpacing: -0.5 }}>
          {fmtCompact(Math.abs(amount))}
        </text>
        {/* Percentage */}
        <text x={cx} y={cy + 4} textAnchor="middle" fill={color} fontSize={7.5} fontWeight="600">
          {(pct * 100).toFixed(0)}%
        </text>
      </svg>
      <p className="text-center text-[9px] leading-tight max-w-[110px] mt-0.5"
        style={{ color: '#94a3b8' }}>
        {label.length > 22 ? label.slice(0, 22) + '…' : label}
      </p>
    </div>
  );
}

// ─── Inline Donut chart ───────────────────────────────────────────────────────
function InlineDonut({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  if (total === 0) return (
    <div style={{ width: 150, height: 150 }} className="flex items-center justify-center">
      <span style={{ color: '#64748b', fontSize: 10 }}>No data</span>
    </div>
  );
  const R = 42, r = 26, cx = 50, cy = 50;
  let angle = -90;
  const slices = data.map(d => {
    const sweep = (d.value / total) * 360;
    const start = angle;
    angle += sweep;
    return { ...d, startAngle: start, sweep };
  });
  const polarToXY = (cx: number, cy: number, r: number, deg: number) => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy + r * Math.sin((deg * Math.PI) / 180),
  });
  const arcPath = (cx: number, cy: number, R: number, r: number, sa: number, sw: number) => {
    if (sw >= 359.9) return `M ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx + R - 0.01} ${cy} Z`;
    const ea = sa + sw;
    const s1 = polarToXY(cx, cy, R, sa);
    const e1 = polarToXY(cx, cy, R, ea);
    const s2 = polarToXY(cx, cy, r, ea);
    const e2 = polarToXY(cx, cy, r, sa);
    const large = sw > 180 ? 1 : 0;
    return `M ${s1.x} ${s1.y} A ${R} ${R} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${r} ${r} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
  };
  return (
    <svg viewBox="0 0 100 100" style={{ width: 155, height: 155, flexShrink: 0 }}>
      {slices.map((s, i) => (
        <path key={i} d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)} fill={s.color}
          style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }} />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize={6} fontWeight="800">
        {fmtCompact(total)}
      </text>
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#64748b" fontSize={4.5}>
        Total
      </text>
    </svg>
  );
}

// ─── Trend line / area chart ──────────────────────────────────────────────────
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span style={{ color: '#64748b', fontSize: 11 }}>Butuh ≥ 2 periode</span>
    </div>
  );
  const W = 480, H = 130, PX = 40, PY = 18;
  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const toX = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const toY = (v: number) => PY + ((maxV - v) / range) * (H - PY * 2 - 12);
  const pts  = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const area = [`${toX(0)},${H - 12}`, ...data.map((d, i) => `${toX(i)},${toY(d.value)}`), `${toX(data.length - 1)},${H - 12}`].join(' ');
  const step = data.length > 12 ? Math.ceil(data.length / 8) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = PY + t * (H - PY * 2 - 12);
        const val = maxV - t * range;
        return (
          <g key={t}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="#1e3a5f" strokeWidth={0.5} />
            <text x={PX - 4} y={y + 2} textAnchor="end" fill="#475569" fontSize={6.5}>
              {fmtCompact(val)}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#areaGrad)" />
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth={1.8} strokeLinejoin="round" />
      {data.map((d, i) => {
        const showDot = data.length <= 30;
        const showLabel = i % step === 0 || i === data.length - 1;
        return (
          <g key={i}>
            {showDot && <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#22d3ee" />}
            {showLabel && (
              <text x={toX(i)} y={H - 2} textAnchor="middle" fill="#64748b" fontSize={7}>
                {d.label.substring(0, 7)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Horizontal bar item ──────────────────────────────────────────────────────
function HBarItem({
  label, value, max, color, rank,
}: { label: string; value: number; max: number; color: string; rank: number }) {
  const pct = max > 0 ? (Math.abs(value) / max) * 100 : 0;
  const isNeg = value < 0;
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-[9px] w-3 text-right flex-shrink-0" style={{ color: '#64748b' }}>{rank}.</span>
      <span className="text-[10px] flex-shrink-0 truncate" style={{ width: 120, color: '#94a3b8' }}
        title={label}>
        {label.length > 16 ? label.slice(0, 16) + '…' : label}
      </span>
      <div className="flex-1 relative h-5 rounded overflow-hidden" style={{ backgroundColor: '#0a1628' }}>
        <div className="h-full rounded transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color, opacity: isNeg ? 0.6 : 0.85 }} />
        <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-white">
          {fmtCompact(value)}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OverviewFluktuasiPage() {
  const [records, setRecords]                   = useState<AkunPeriodeRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  // Filters
  const [selectedYear,       setSelectedYear]       = useState<string>('all');
  const [filterKlasifikasi,  setFilterKlasifikasi]  = useState<Set<string>>(new Set());
  const [filterAccount,      setFilterAccount]      = useState<Set<string>>(new Set());
  const [listPage,           setListPage]           = useState(0);
  const LIST_PAGE_SIZE = 100;

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/fluktuasi/akun-periodes')
      .then(r => r.json())
      .then(data => { if (data.success && Array.isArray(data.data)) setRecords(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────
  const years = useMemo(() => {
    const s = new Set(records.map(r => r.periode.split('.')[0]));
    return [...s].sort();
  }, [records]);

  const allKlasifikasi = useMemo(() => {
    const s = new Set(records.map(r => r.klasifikasi || '(Tanpa Klasifikasi)'));
    return [...s].sort();
  }, [records]);

  const allAccounts = useMemo(() => {
    const s = new Set(records.map(r => r.accountCode));
    return [...s].sort();
  }, [records]);

  const filtered = useMemo(() => records.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterKlasifikasi.size > 0 && !filterKlasifikasi.has(r.klasifikasi || '(Tanpa Klasifikasi)')) return false;
    if (filterAccount.size > 0 && !filterAccount.has(r.accountCode)) return false;
    return true;
  }), [records, selectedYear, filterKlasifikasi, filterAccount]);

  // Total by year for trend buttons
  const byYear = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach(r => {
      const yr = r.periode.split('.')[0];
      m.set(yr, (m.get(yr) ?? 0) + r.amount);
    });
    return years.map(yr => ({ yr, total: m.get(yr) ?? 0 }));
  }, [records, years]);

  // By klasifikasi (filtered)
  const byKlasifikasi = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const k = r.klasifikasi || '(Tanpa Klasifikasi)';
      m.set(k, (m.get(k) ?? 0) + r.amount);
    });
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  }, [filtered]);

  // By periode (filtered)
  const byPeriode = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.periode, (m.get(r.periode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
  }, [filtered]);

  // Top 10 accounts (filtered)
  const top10Accounts = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([acc, val]) => ({ label: acc, value: val }));
  }, [filtered]);

  // By account + klasifikasi for listing table (sorted by absolute amount desc)
  const listingRows = useMemo(() => {
    const m = new Map<string, { accountCode: string; klasifikasi: string; total: number; periodes: number }>();
    filtered.forEach(r => {
      const key = `${r.accountCode}|${r.klasifikasi || '(Tanpa Klasifikasi)'}`;
      const ex  = m.get(key) ?? { accountCode: r.accountCode, klasifikasi: r.klasifikasi || '(Tanpa Klasifikasi)', total: 0, periodes: 0 };
      m.set(key, { ...ex, total: ex.total + r.amount, periodes: ex.periodes + 1 });
    });
    return [...m.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered]);

  const listingTotalPages = Math.ceil(listingRows.length / LIST_PAGE_SIZE);
  const listingPage       = useMemo(() => listingRows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE), [listingRows, listPage]);

  const totalFiltered  = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);
  const maxAbsKlasi    = byKlasifikasi.length > 0 ? Math.abs(byKlasifikasi[0].value) : 1;
  const maxAbsAccount  = top10Accounts.length > 0 ? Math.abs(top10Accounts[0].value) : 1;
  const donutTotal     = byKlasifikasi.reduce((s, d) => s + Math.abs(d.value), 0);

  // MoM / YoY for summary card
  const lastTwo = byPeriode.slice(-2);
  const momGap  = lastTwo.length === 2 ? lastTwo[1].value - lastTwo[0].value : null;
  const momPct  = lastTwo.length === 2 && lastTwo[0].value !== 0 ? (momGap! / Math.abs(lastTwo[0].value)) * 100 : null;

  // Toggle helpers
  const toggleKlasifikasi = (k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const toggleAccount = (a: string) => setFilterAccount(prev => {
    const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n;
  });
  const resetFilters = () => { setSelectedYear('all'); setFilterKlasifikasi(new Set()); setFilterAccount(new Set()); setListPage(0); };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: '#080f1c' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400" />
        <p style={{ color: '#94a3b8', fontSize: 14 }}>Memuat data fluktuasi…</p>
      </div>
    </div>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  if (records.length === 0) return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#080f1c' }}>
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: '#0d1f3c' }}>
            <TrendingUp size={32} style={{ color: '#22d3ee' }} />
          </div>
          <p style={{ color: 'white', fontSize: 18, fontWeight: 700 }}>Belum ada data fluktuasi</p>
          <p style={{ color: '#64748b', fontSize: 13 }}>Upload file Excel di halaman <strong style={{ color: '#22d3ee' }}>Fluktuasi OI/EXP</strong> terlebih dahulu</p>
        </div>
      </div>
    </div>
  );

  // ── Full dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#080f1c' }}>
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">

        {/* ── TITLE BAR ─────────────────────────────────────────────────── */}
        <div style={{ backgroundColor: '#0b1525', borderBottom: '1px solid #1e3a5f', flexShrink: 0 }}
          className="px-4 py-2.5 flex flex-wrap items-center gap-3">
          {/* Mobile menu */}
          <button onClick={() => setMobileSidebar(true)} className="lg:hidden p-1"
            style={{ color: '#94a3b8' }}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
            </svg>
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div style={{ width: 3, height: 28, backgroundColor: '#22d3ee', borderRadius: 2 }} />
              <div>
                <p style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>SIG ACTIVA</p>
                <h1 style={{ color: 'white', fontSize: 18, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1 }}>
                  OVERVIEW FLUKTUASI OI/EXP
                </h1>
                <p style={{ color: '#64748b', fontSize: 10 }}>
                  {selectedYear === 'all' ? 'Semua Periode' : `Tahun ${selectedYear}`}
                  {(filterKlasifikasi.size > 0 || filterAccount.size > 0) ? ' · Terfilter' : ''}
                  {' · '}
                  {filtered.length.toLocaleString('id-ID')} records
                </p>
              </div>
            </div>
          </div>

          {/* Trend annual buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ color: '#475569', fontSize: 10, fontWeight: 600 }} className="hidden md:block">
              TREND TAHUNAN :
            </span>
            {byYear.map(({ yr, total }, i) => (
              <button key={yr}
                onClick={() => { setSelectedYear(yr === selectedYear ? 'all' : yr); setListPage(0); }}
                className="flex flex-col items-center justify-center transition"
                style={{
                  backgroundColor: selectedYear === yr ? '#22d3ee' : i === byYear.length - 1 ? '#0d2240' : '#0a1c35',
                  color:           selectedYear === yr ? '#080f1c' : 'white',
                  border:          selectedYear === yr ? '2px solid #22d3ee' : '1px solid #1e3a5f',
                  borderRadius:    6,
                  minWidth:        76,
                  padding:         '4px 10px',
                  fontWeight:      700,
                }}>
                <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.75 }}>{yr}</span>
                <span style={{ fontSize: 13 }}>{fmtCompact(total)}</span>
              </button>
            ))}
            <button onClick={resetFilters}
              className="flex items-center gap-1 transition"
              style={{ backgroundColor: '#1a0808', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
              <RotateCcw size={11} /> Reset
            </button>
          </div>
        </div>

        {/* ── CONTENT ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e3a5f transparent' }}>

          {/* ── ROW 1: LEFT + CENTER + RIGHT ─────────────────────────────── */}
          <div className="grid gap-3"
            style={{ gridTemplateColumns: 'minmax(240px,280px) 1fr minmax(200px,220px)' }}>

            {/* ── LEFT ──────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3">

              {/* Donut + legend */}
              <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
                <p style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}
                  className="mb-2">Distribusi Klasifikasi</p>
                <div className="flex items-start gap-2">
                  <InlineDonut data={byKlasifikasi.slice(0, 10).map(d => ({ ...d, value: Math.abs(d.value) }))} total={donutTotal} />
                  <div className="flex flex-col gap-1 flex-1 min-w-0 mt-2">
                    {byKlasifikasi.slice(0, 7).map((d, i) => {
                      const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100).toFixed(1) : '0.0';
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="flex-shrink-0 rounded-sm" style={{ width: 8, height: 8, backgroundColor: d.color }} />
                          <span className="truncate flex-1 text-[10px]" style={{ color: '#94a3b8' }}
                            title={d.label}>{d.label.length > 15 ? d.label.slice(0, 15) + '…' : d.label}</span>
                          <span className="text-[9px] flex-shrink-0" style={{ color: '#64748b' }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Summary table */}
                <div style={{ borderTop: '1px solid #1e3a5f', marginTop: 8, paddingTop: 8 }}>
                  <table className="w-full" style={{ fontSize: 9.5 }}>
                    <tbody>
                      {byKlasifikasi.slice(0, 6).map((d, i) => {
                        const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100) : 0;
                        return (
                          <tr key={i}>
                            <td style={{ color: '#64748b', padding: '1.5px 0' }}>{i + 1}.</td>
                            <td style={{ color: '#94a3b8', padding: '1.5px 4px', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={d.label}>{d.label}</td>
                            <td style={{ color: '#e2e8f0', textAlign: 'right', fontFamily: 'monospace', padding: '1.5px 0' }}>
                              {fmtCompact(d.value)}
                            </td>
                            <td style={{ color: '#64748b', textAlign: 'right', paddingLeft: 4 }}>
                              {pct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: '1px solid #1e3a5f' }}>
                        <td colSpan={2} style={{ color: '#e2e8f0', fontWeight: 700, padding: '2px 0' }}>Total</td>
                        <td style={{ color: 'white', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                          {fmtCompact(totalFiltered)}
                        </td>
                        <td style={{ color: '#64748b', textAlign: 'right', paddingLeft: 4 }}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Per-year summary cards */}
              <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
                <p style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}
                  className="mb-2">Total Per Tahun</p>
                <div className="space-y-1.5">
                  {byYear.map(({ yr, total }) => {
                    const isPos = total >= 0;
                    const isSelected = selectedYear === yr;
                    return (
                      <div key={yr}
                        onClick={() => { setSelectedYear(yr === selectedYear ? 'all' : yr); setListPage(0); }}
                        className="flex items-center justify-between p-2 rounded cursor-pointer transition"
                        style={{
                          border:          isSelected ? '1px solid #22d3ee' : '1px solid #1e3a5f',
                          backgroundColor: isSelected ? '#0d2240' : 'transparent',
                        }}>
                        <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 500 }}>Tahun {yr}</span>
                        <span style={{ color: isPos ? '#22d3ee' : '#f87171', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
                          {fmtCompact(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* MoM summary */}
                {momGap !== null && momPct !== null && (
                  <div style={{ borderTop: '1px solid #1e3a5f', marginTop: 8, paddingTop: 8 }}>
                    <p style={{ color: '#64748b', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
                      className="mb-1.5">MoM Terkini</p>
                    <div className="flex items-center gap-2">
                      <div style={{ color: momGap > 0 ? '#4ade80' : momGap < 0 ? '#f87171' : '#94a3b8' }}>
                        {momGap > 0 ? <TrendingUp size={18} /> : momGap < 0 ? <TrendingDown size={18} /> : <Minus size={18} />}
                      </div>
                      <div>
                        <p style={{ color: momGap > 0 ? '#4ade80' : momGap < 0 ? '#f87171' : '#94a3b8', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
                          {fmtCompact(momGap)}
                        </p>
                        <p style={{ color: '#64748b', fontSize: 9 }}>
                          {momPct.toFixed(1)}% dari {lastTwo[0]?.label}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── CENTER ────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3">

              {/* Semi-circular gauges */}
              <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
                <p style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}
                  className="mb-3">KLASIFIKASI GROUPING FLUKTUASI</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {byKlasifikasi.slice(0, 7).map((d, i) => (
                    <SemiGauge key={i}
                      value={Math.abs(d.value)}
                      max={maxAbsKlasi}
                      label={d.label}
                      amount={d.value}
                      color={d.color} />
                  ))}
                </div>

                {/* Horizontal bars below gauges */}
                <div style={{ marginTop: 12, borderTop: '1px solid #1e3a5f', paddingTop: 10 }} className="space-y-2">
                  {byKlasifikasi.slice(0, 8).map((d, i) => {
                    const pct = maxAbsKlasi > 0 ? (Math.abs(d.value) / maxAbsKlasi) * 100 : 0;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span style={{ color: '#475569', fontSize: 9, width: 60, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>
                          {fmtCompact(Math.abs(d.value))}
                        </span>
                        <div className="flex-1 relative h-5 rounded overflow-hidden" style={{ backgroundColor: '#060d1a' }}>
                          <div className="h-full rounded transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: d.color, opacity: 0.8 }} />
                          <span className="absolute inset-0 flex items-center px-2 text-[9px] text-white font-medium truncate"
                            style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>{d.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Trend chart */}
              <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <p style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                    TREN FLUKTUASI PER PERIODE
                  </p>
                  <span style={{ color: '#475569', fontSize: 9 }}>{byPeriode.length} periode</span>
                </div>
                <div style={{ height: 148 }}>
                  <TrendChart data={byPeriode} />
                </div>
              </div>
            </div>

            {/* ── RIGHT (FILTER) ─────────────────────────────────────────── */}
            <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
              <div className="flex items-center justify-between mb-3">
                <p style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  FILTER
                </p>
                <button onClick={resetFilters} style={{ color: '#22d3ee', fontSize: 10 }}
                  className="hover:opacity-80 transition">Reset</button>
              </div>

              {/* Klasifikasi */}
              <div className="mb-3">
                <p style={{ color: '#475569', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}
                  className="mb-1.5">Klasifikasi</p>
                <div style={{ border: '1px solid #1e3a5f', borderRadius: 6, backgroundColor: '#060d1a', maxHeight: 160, overflowY: 'auto' }}
                  className="p-1.5">
                  {allKlasifikasi.map(k => {
                    const color = byKlasifikasi.find(d => d.label === k)?.color ?? '#64748b';
                    const amt   = byKlasifikasi.find(d => d.label === k)?.value ?? 0;
                    const isChecked = filterKlasifikasi.size === 0 || filterKlasifikasi.has(k);
                    return (
                      <label key={k} className="flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer hover:bg-[#0d1f3c] transition">
                        <input type="checkbox" checked={isChecked} onChange={() => { toggleKlasifikasi(k); setListPage(0); }}
                          className="w-3 h-3 rounded" style={{ accentColor: '#22d3ee' }} />
                        <span className="flex-shrink-0 w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                        <span className="flex-1 truncate" style={{ color: '#94a3b8', fontSize: 9.5 }} title={k}>
                          {k.length > 18 ? k.slice(0, 18) + '…' : k}
                        </span>
                        <span style={{ color: '#475569', fontSize: 8.5, flexShrink: 0 }}>{fmtCompact(amt)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Kode Akun */}
              <div>
                <p style={{ color: '#475569', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}
                  className="mb-1.5">Kode Akun</p>
                <div style={{ border: '1px solid #1e3a5f', borderRadius: 6, backgroundColor: '#060d1a', maxHeight: 180, overflowY: 'auto' }}
                  className="p-1.5">
                  {allAccounts.map(a => {
                    const amt = records.filter(r => r.accountCode === a && (selectedYear === 'all' || r.periode.startsWith(selectedYear + '.')))
                      .reduce((s, r) => s + r.amount, 0);
                    const isChecked = filterAccount.size === 0 || filterAccount.has(a);
                    return (
                      <label key={a} className="flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer hover:bg-[#0d1f3c] transition">
                        <input type="checkbox" checked={isChecked} onChange={() => { toggleAccount(a); setListPage(0); }}
                          className="w-3 h-3 rounded" style={{ accentColor: '#22d3ee' }} />
                        <span className="flex-1 font-mono" style={{ color: '#94a3b8', fontSize: 9.5 }}>{a}</span>
                        <span style={{ color: '#475569', fontSize: 8.5, flexShrink: 0 }}>{fmtCompact(amt)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── ROW 2: AGING CHART + TOP 10 ACCOUNTS ────────────────────── */}
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr minmax(300px,380px)' }}>

            {/* Aging / periode distribution chart */}
            <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
              <p style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}
                className="mb-2">AGING FLUKTUASI</p>

              {/* Group into 5 aging buckets by how many periods ago */}
              {(() => {
                const sortedPeriodes = [...new Map(filtered.map(r => [r.periode, 0])).keys()].sort();
                const n = sortedPeriodes.length;
                const buckets: { label: string; value: number }[] = [];
                if (n > 0) {
                  const bSize = Math.ceil(n / 5);
                  for (let b = 0; b < 5; b++) {
                    const start = b * bSize;
                    const end   = Math.min(start + bSize, n);
                    const pSlice = sortedPeriodes.slice(start, end);
                    const sum    = filtered
                      .filter(r => pSlice.includes(r.periode))
                      .reduce((s, r) => s + r.amount, 0);
                    const label  = pSlice.length > 0
                      ? `${b + 1}. ${periodeToLabel(pSlice[0])}${pSlice.length > 1 ? '–' + periodeToLabel(pSlice[pSlice.length - 1]) : ''}`
                      : `Bucket ${b + 1}`;
                    buckets.push({ label, value: sum });
                  }
                }
                const maxAbsB = Math.max(...buckets.map(b => Math.abs(b.value)), 1);
                const bColors = ['#22d3ee','#34d399','#f59e0b','#f87171','#a78bfa'];
                return (
                  <div style={{ position: 'relative', height: 140 }}>
                    <svg viewBox="0 0 480 140" style={{ width: '100%', height: '100%' }}>
                      {buckets.map((b, i) => {
                        const bw  = 40;
                        const gap = (480 - 40 - 5 * bw) / (buckets.length - 1 || 1);
                        const x   = 40 + i * (bw + gap);
                        const barH = b.value !== 0 ? (Math.abs(b.value) / maxAbsB) * 90 : 2;
                        const isNeg = b.value < 0;
                        const y   = 10 + 90 - barH;
                        return (
                          <g key={i}>
                            <rect x={x} y={y} width={bw} height={barH} rx={3}
                              fill={bColors[i % bColors.length]} opacity={isNeg ? 0.6 : 0.85} />
                            <text x={x + bw / 2} y={y - 3} textAnchor="middle" fill="white" fontSize={7.5} fontWeight="700">
                              {fmtCompact(b.value)}
                            </text>
                            <text x={x + bw / 2} y={125} textAnchor="middle" fill="#64748b" fontSize={6.5}>
                              {b.label.split('.')[0].trim()}
                            </text>
                            <text x={x + bw / 2} y={134} textAnchor="middle" fill="#475569" fontSize={5.5}>
                              {b.label.split(/[.\s]/).slice(1).join(' ').substring(0, 14)}
                            </text>
                          </g>
                        );
                      })}
                      {/* Baseline */}
                      <line x1={40} y1={100} x2={480} y2={100} stroke="#1e3a5f" strokeWidth={0.5} />
                    </svg>
                  </div>
                );
              })()}
            </div>

            {/* Top 10 Accounts */}
            <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="p-3">
              <p style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}
                className="mb-2">TOP 10 AKUN OUTSTANDING</p>
              <div className="space-y-1.5">
                {top10Accounts.map((a, i) => (
                  <HBarItem key={i} label={a.label} value={a.value} max={maxAbsAccount}
                    color={PALETTE[i % PALETTE.length]} rank={i + 1} />
                ))}
                {top10Accounts.length === 0 && (
                  <p style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: 16 }}>Tidak ada data</p>
                )}
              </div>
            </div>
          </div>

          {/* ── LISTING TABLE ────────────────────────────────────────────── */}
          <div style={{ backgroundColor: '#0b1a2e', border: '1px solid #1e3a5f', borderRadius: 8 }} className="overflow-hidden">
            <div style={{ borderBottom: '1px solid #1e3a5f' }} className="px-4 py-2.5 flex items-center justify-between">
              <div>
                <p style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  LISTING OUTSTANDING
                </p>
                <p style={{ color: '#475569', fontSize: 9 }}>
                  {listingRows.length.toLocaleString('id-ID')} entri
                  {listingTotalPages > 1 && ` · Hal ${listPage + 1}/${listingTotalPages}`}
                </p>
              </div>
              {listingTotalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button disabled={listPage === 0}
                    onClick={() => setListPage(p => Math.max(0, p - 1))}
                    style={{ color: '#64748b', fontSize: 14, padding: '2px 8px', border: '1px solid #1e3a5f', borderRadius: 4, backgroundColor: '#060d1a' }}
                    className="disabled:opacity-30">‹</button>
                  <button disabled={listPage >= listingTotalPages - 1}
                    onClick={() => setListPage(p => Math.min(listingTotalPages - 1, p + 1))}
                    style={{ color: '#64748b', fontSize: 14, padding: '2px 8px', border: '1px solid #1e3a5f', borderRadius: 4, backgroundColor: '#060d1a' }}
                    className="disabled:opacity-30">›</button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#060d1a' }}>
                    {['#','Kode Akun','Klasifikasi','Total Amount','Jml Periode'].map(h => (
                      <th key={h} style={{ padding: '7px 12px', textAlign: h === 'Total Amount' ? 'right' : 'left', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1e3a5f', whiteSpace: 'nowrap', fontSize: 9 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listingPage.map((row, ri) => {
                    const globalRi = listPage * LIST_PAGE_SIZE + ri;
                    const isPos    = row.total >= 0;
                    const rowBg    = ri % 2 === 0 ? 'transparent' : '#0a111f';
                    return (
                      <tr key={ri} style={{ backgroundColor: rowBg, borderBottom: '1px solid #0f1e35' }}>
                        <td style={{ padding: '5px 12px', color: '#475569' }}>{globalRi + 1}.</td>
                        <td style={{ padding: '5px 12px', color: '#22d3ee', fontFamily: 'monospace', fontWeight: 600 }}>{row.accountCode}</td>
                        <td style={{ padding: '5px 12px', color: '#94a3b8', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={row.klasifikasi}>{row.klasifikasi}</td>
                        <td style={{ padding: '5px 12px', textAlign: 'right', color: isPos ? '#4ade80' : '#f87171', fontFamily: 'monospace', fontWeight: 700 }}>
                          {fmtFull(row.total)}
                        </td>
                        <td style={{ padding: '5px 12px', color: '#64748b', textAlign: 'right' }}>{row.periodes}</td>
                      </tr>
                    );
                  })}
                  {listingPage.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#475569' }}>
                        Tidak ada data sesuai filter
                      </td>
                    </tr>
                  )}
                </tbody>
                {listingPage.length > 0 && (
                  <tfoot>
                    <tr style={{ backgroundColor: '#060d1a', borderTop: '1px solid #1e3a5f' }}>
                      <td colSpan={3} style={{ padding: '6px 12px', color: '#94a3b8', fontWeight: 700, fontSize: 10 }}>
                        TOTAL (filtered)
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', color: totalFiltered >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace', fontWeight: 800, fontSize: 12 }}>
                        {fmtFull(totalFiltered)}
                      </td>
                      <td style={{ padding: '6px 12px', color: '#64748b', textAlign: 'right', fontSize: 10 }}>
                        {filtered.length} records
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
