'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw } from 'lucide-react';

const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });
const Header  = dynamic(() => import('../components/Header'),  { ssr: false });

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type AkunPeriodeRecord = {
  id?: number;
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi: string;
  remark: string;
};

type SubGroup = {
  code: string;   // e.g. "71510000"
  prefix: string; // e.g. "7151"
  label: string;  // display name
  color: string;
};

// â”€â”€â”€ Sub-account groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SUB_GROUPS: SubGroup[] = [
  { code: '71300000', prefix: '7130', label: '71300000', color: '#2563eb' },
  { code: '71400000', prefix: '7140', label: '71400000', color: '#16a34a' },
  { code: '71510000', prefix: '7151', label: '71510000', color: '#d97706' },
  { code: '71600000', prefix: '7160', label: '71600000', color: '#7c3aed' },
];

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const fmtCompact = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(1).replace('.', ',') + ' M';
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

const KLASI_PALETTE = [
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#ea580c','#0891b2','#15803d','#9333ea','#ca8a04',
  '#4f46e5','#e11d48',
];

// â”€â”€â”€ Donut Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  if (total === 0) return (
    <div className="flex items-center justify-center" style={{ width: 200, height: 200 }}>
      <span className="text-slate-400 text-xs">No data</span>
    </div>
  );
  const R = 80, r = 50, cx = 100, cy = 100;
  let angle = -90;
  const slices = data.map(d => {
    const sweep = (Math.abs(d.value) / total) * 360;
    const start = angle;
    angle += sweep;
    return { ...d, startAngle: start, sweep };
  });
  const polarToXY = (pcx: number, pcy: number, radius: number, deg: number) => ({
    x: pcx + radius * Math.cos((deg * Math.PI) / 180),
    y: pcy + radius * Math.sin((deg * Math.PI) / 180),
  });
  const arcPath = (pcx: number, pcy: number, oR: number, ir: number, sa: number, sw: number) => {
    if (sw >= 359.9) {
      const top = polarToXY(pcx, pcy, oR, sa);
      const bot = polarToXY(pcx, pcy, oR, sa + 180);
      const ti  = polarToXY(pcx, pcy, ir, sa);
      const bi  = polarToXY(pcx, pcy, ir, sa + 180);
      return `M ${top.x} ${top.y} A ${oR} ${oR} 0 1 1 ${bot.x} ${bot.y} A ${oR} ${oR} 0 1 1 ${top.x} ${top.y} Z M ${ti.x} ${ti.y} A ${ir} ${ir} 0 1 0 ${bi.x} ${bi.y} A ${ir} ${ir} 0 1 0 ${ti.x} ${ti.y} Z`;
    }
    const ea = sa + sw;
    const s1 = polarToXY(pcx, pcy, oR, sa);
    const e1 = polarToXY(pcx, pcy, oR, ea);
    const s2 = polarToXY(pcx, pcy, ir, ea);
    const e2 = polarToXY(pcx, pcy, ir, sa);
    const large = sw > 180 ? 1 : 0;
    return `M ${s1.x} ${s1.y} A ${oR} ${oR} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${ir} ${ir} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
  };
  return (
    <svg viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="#f1f5f9" />
      {slices.map((s, i) => (
        <path key={i} d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)} fill={s.color} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="white" />
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#1e293b" fontSize={13} fontWeight="800">
        {fmtCompact(total)}
      </text>
      <text x={cx} y={cy + 7} textAnchor="middle" fill="#94a3b8" fontSize={8}>
        Total Outstanding
      </text>
    </svg>
  );
}

// â”€â”€â”€ Trend chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-slate-400 text-xs">Butuh â‰¥ 2 periode</span>
    </div>
  );
  const W = 480, H = 130, PX = 44, PY = 16;
  const vals  = data.map(d => d.value);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range = maxV - minV || 1;
  const toX = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const toY = (v: number) => PY + ((maxV - v) / range) * (H - PY * 2 - 14);
  const pts  = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const area = [
    `${toX(0)},${H - 14}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${H - 14}`,
  ].join(' ');
  const step = data.length > 12 ? Math.ceil(data.length / 10) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y   = PY + t * (H - PY * 2 - 14);
        const val = maxV - t * range;
        return (
          <g key={t}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="#e2e8f0" strokeWidth={0.8} />
            <text x={PX - 4} y={y + 2} textAnchor="end" fill="#94a3b8" fontSize={7}>
              {fmtCompact(val)}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#trendGrad)" />
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => {
        const showDot   = data.length <= 30;
        const showLabel = i % step === 0 || i === data.length - 1;
        return (
          <g key={i}>
            {showDot && <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#2563eb" stroke="white" strokeWidth={1} />}
            {showLabel && (
              <text x={toX(i)} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize={7}>
                {d.label.substring(0, 7)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function SubAkunFluktuasiPage() {
  const [records, setRecords]                   = useState<AkunPeriodeRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  // Filters
  const [selectedYear,      setSelectedYear]      = useState<string>('all');
  const [filterSubAkun,     setFilterSubAkun]     = useState<Set<string>>(new Set());
  const [filterKlasifikasi, setFilterKlasifikasi] = useState<Set<string>>(new Set());

  // Listing
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 50;

  useEffect(() => {
    fetch('/api/fluktuasi/akun-periodes')
      .then(r => r.json())
      .then(data => { if (data.success && Array.isArray(data.data)) setRecords(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // â”€â”€ Derived â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const years = useMemo(() => {
    const s = new Set(records.map(r => r.periode.split('.')[0]));
    return [...s].sort();
  }, [records]);

  // Only records belonging to our 4 sub groups
  const subAkunRecords = useMemo(() =>
    records.filter(r => SUB_GROUPS.some(g => r.accountCode.startsWith(g.prefix))),
  [records]);

  // All klasifikasi within sub-akun scope
  const allKlasifikasi = useMemo(() => {
    const s = new Set(subAkunRecords.map(r => r.klasifikasi || '(Tanpa Klasifikasi)'));
    return [...s].sort();
  }, [subAkunRecords]);

  // Filtered records
  const filtered = useMemo(() => subAkunRecords.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterSubAkun.size > 0) {
      const match = SUB_GROUPS.find(g => r.accountCode.startsWith(g.prefix));
      if (!match || !filterSubAkun.has(match.code)) return false;
    }
    if (filterKlasifikasi.size > 0) {
      if (!filterKlasifikasi.has(r.klasifikasi || '(Tanpa Klasifikasi)')) return false;
    }
    return true;
  }), [subAkunRecords, selectedYear, filterSubAkun, filterKlasifikasi]);

  const totalFiltered = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  // Donut data: per sub group
  const donutData = useMemo(() => SUB_GROUPS.map(g => ({
    label: g.label,
    value: filtered.filter(r => r.accountCode.startsWith(g.prefix)).reduce((s, r) => s + r.amount, 0),
    color: g.color,
  })).filter(d => d.value !== 0), [filtered]);
  const donutTotal = useMemo(() => donutData.reduce((s, d) => s + Math.abs(d.value), 0), [donutData]);

  // Trend per periode
  const byPeriode = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.periode, (m.get(r.periode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
  }, [filtered]);

  // Sub-akun totals
  const subAkunTotals = useMemo(() =>
    SUB_GROUPS.map(g => ({
      group: g,
      total: filtered.filter(r => r.accountCode.startsWith(g.prefix)).reduce((s, r) => s + r.amount, 0),
    })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  [filtered]);

  // Klasifikasi totals
  const klasifikasiTotals = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const k = r.klasifikasi || '(Tanpa Klasifikasi)';
      m.set(k, (m.get(k) ?? 0) + r.amount);
    });
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: KLASI_PALETTE[i % KLASI_PALETTE.length] }));
  }, [filtered]);

  // Listing rows
  const listingRows = useMemo(() => {
    const m = new Map<string, {
      subGroup: SubGroup | undefined;
      accountCode: string;
      klasifikasi: string;
      total: number;
      periodes: number;
    }>();
    filtered.forEach(r => {
      const key = `${r.accountCode}|${r.klasifikasi}`;
      const sg  = SUB_GROUPS.find(g => r.accountCode.startsWith(g.prefix));
      const ex  = m.get(key) ?? { subGroup: sg, accountCode: r.accountCode, klasifikasi: r.klasifikasi || '(Tanpa Klasifikasi)', total: 0, periodes: 0 };
      m.set(key, { ...ex, total: ex.total + r.amount, periodes: ex.periodes + 1 });
    });
    return [...m.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered]);

  const listingTotalPages = Math.ceil(listingRows.length / LIST_PAGE_SIZE);
  const listingPage = useMemo(
    () => listingRows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE),
    [listingRows, listPage],
  );

  // Latest periode label for subtitle
  const latestPeriode = useMemo(() => {
    const all = [...new Set(records.map(r => r.periode))].sort();
    return all.length > 0 ? periodeToLabel(all[all.length - 1]) : '-';
  }, [records]);

  const resetFilters = () => {
    setSelectedYear('all');
    setFilterSubAkun(new Set());
    setFilterKlasifikasi(new Set());
    setListPage(0);
  };
  const toggleSubAkun = (code: string) => setFilterSubAkun(prev => {
    const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n;
  });
  const toggleKlasifikasi = (k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  // â”€â”€ Shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const shell = (content: React.ReactNode) => (
    <div className="flex min-h-screen bg-gray-50">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <Header
          title="Dashboard Sub Akun Fluktuasi"
          subtitle={`per ${latestPeriode}`}
          onMenuClick={() => setMobileSidebar(true)}
        />
        {content}
      </div>
    </div>
  );

  if (loading) return shell(
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        <p className="text-slate-500 text-sm">Memuat data fluktuasi...</p>
      </div>
    </div>
  );

  if (records.length === 0) return shell(
    <div className="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <p className="text-slate-600 font-semibold text-lg">Belum ada data fluktuasi</p>
        <p className="text-slate-400 text-sm mt-1">Upload data di halaman <strong className="text-blue-600">Fluktuasi OI/EXP</strong></p>
      </div>
    </div>
  );

  return shell(
    <div className="flex-1 overflow-y-auto">

      {/* â”€â”€ Reset button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex justify-end px-4 pt-3">
        <button onClick={resetFilters}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#dc2626', color: 'white' }}>
          <RotateCcw size={13} /> Reset Filter
        </button>
      </div>

      {/* â”€â”€ 3-col top panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid gap-3 px-4 pt-2 pb-3" style={{ gridTemplateColumns: '280px 1fr 260px' }}>

        {/* LEFT â€“ Donut + legend */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 flex flex-col">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center mb-3">
            DISTRIBUSI SUB AKUN FLUKTUASI
          </p>
          <div className="flex flex-col items-center gap-3 flex-1">
            <DonutChart data={donutData} total={donutTotal} />
            <div className="w-full space-y-2">
              {donutData.map((d, i) => {
                const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100).toFixed(1) : '0.0';
                return (
                  <div key={i} className="flex items-center gap-2 cursor-pointer"
                    onClick={() => { toggleSubAkun(SUB_GROUPS.find(g => g.label === d.label)?.code ?? ''); setListPage(0); }}>
                    <span className="flex-shrink-0 rounded-sm" style={{ width: 10, height: 10, backgroundColor: d.color }} />
                    <span className="flex-1 text-[10px] font-mono text-slate-600">{d.label}</span>
                    <span className="text-[10px] font-bold font-mono"
                      style={{ color: d.value >= 0 ? '#16a34a' : '#dc2626' }}>
                      {fmtCompact(d.value)}
                    </span>
                    <span className="text-[9px] text-slate-400 w-9 text-right">{pct}%</span>
                  </div>
                );
              })}
              <div className="border-t border-gray-100 pt-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600">Total keseluruhan</span>
                <span className="text-[11px] font-extrabold font-mono"
                  style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                  {fmtFull(totalFiltered)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER â€“ Trend chart + tables */}
        <div className="flex flex-col gap-3">

          {/* Trend chart */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                TREN TOTAL FLUKTUASI PER PERIODE
              </p>
              <div className="flex items-center gap-1 text-[9px] text-slate-400">
                <span className="inline-block w-6 h-0.5 bg-blue-600 rounded" />
                Amount Outstanding
              </div>
            </div>
            {/* Year quick filter */}
            <div className="flex flex-wrap gap-1 mb-2">
              <button onClick={() => setSelectedYear('all')}
                className="px-2 py-0.5 rounded text-[9px] font-semibold transition"
                style={{
                  backgroundColor: selectedYear === 'all' ? '#2563eb' : '#f1f5f9',
                  color: selectedYear === 'all' ? 'white' : '#64748b',
                }}>Semua</button>
              {years.map(yr => (
                <button key={yr} onClick={() => setSelectedYear(yr)}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold transition"
                  style={{
                    backgroundColor: selectedYear === yr ? '#2563eb' : '#f1f5f9',
                    color: selectedYear === yr ? 'white' : '#64748b',
                  }}>{yr}</button>
              ))}
            </div>
            <div style={{ height: 130 }}>
              <TrendChart data={byPeriode} />
            </div>
          </div>

          {/* Two summary tables side by side */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>

              {/* Sub Akun table */}
              <div className="border-r border-gray-100">
                <div className="px-3 py-2 border-b border-gray-100 bg-slate-50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sub Akun</p>
                </div>
                <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                      <th className="px-3 py-1.5 text-left text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: '#bfdbfe' }}>Kode</th>
                      <th className="px-3 py-1.5 text-right text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: '#bfdbfe' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subAkunTotals.map(({ group, total }, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                        style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="px-3 py-1.5 font-mono font-semibold" style={{ color: group.color }}>
                          {group.label}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold"
                          style={{ color: total >= 0 ? '#16a34a' : '#dc2626' }}>
                          {fmtFull(total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 bg-slate-50">
                      <td className="px-3 py-1.5 font-bold text-slate-600 text-[10px]">Total keseluruhan</td>
                      <td className="px-3 py-1.5 text-right font-extrabold font-mono text-[11px]"
                        style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmtFull(totalFiltered)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Klasifikasi table */}
              <div>
                <div className="px-3 py-2 border-b border-gray-100 bg-slate-50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Klasifikasi</p>
                </div>
                <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                      <th className="px-3 py-1.5 text-left text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: '#bfdbfe' }}>Klasifikasi</th>
                      <th className="px-3 py-1.5 text-right text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: '#bfdbfe' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {klasifikasiTotals.slice(0, 5).map((d, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                        style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="px-3 py-1.5 text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <span className="flex-shrink-0 rounded-sm w-2 h-2" style={{ backgroundColor: d.color }} />
                            <span className="truncate max-w-[130px]" title={d.label}>{d.label}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold"
                          style={{ color: d.value >= 0 ? '#16a34a' : '#dc2626' }}>
                          {fmtFull(d.value)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 bg-slate-50">
                      <td className="px-3 py-1.5 font-bold text-slate-600 text-[10px]">Total keseluruhan</td>
                      <td className="px-3 py-1.5 text-right font-extrabold font-mono text-[11px]"
                        style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmtFull(totalFiltered)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT â€“ Filter panel */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 flex flex-col gap-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">FILTER</p>

          {/* Sub Akun checkboxes */}
          <div>
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Sub Kode Akun</p>
            <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
              <div className="flex items-center px-2 py-1 bg-slate-100 border-b border-gray-200">
                <span className="flex-1 text-[8.5px] font-semibold text-slate-500 uppercase">Sub Akun</span>
                <span className="text-[8.5px] font-semibold text-slate-500 uppercase">Amount</span>
              </div>
              {SUB_GROUPS.map(g => {
                const amt       = filtered.filter(r => r.accountCode.startsWith(g.prefix)).reduce((s, r) => s + r.amount, 0);
                const isChecked = filterSubAkun.size === 0 || filterSubAkun.has(g.code);
                return (
                  <label key={g.code}
                    className="flex items-center gap-2 px-2 py-1 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-blue-50 transition">
                    <input type="checkbox" checked={isChecked}
                      onChange={() => { toggleSubAkun(g.code); setListPage(0); }}
                      className="w-3 h-3" style={{ accentColor: g.color }} />
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="flex-1 text-[10px] font-mono text-slate-700">{g.label}</span>
                    <span className="text-[9px] font-mono text-slate-500">{fmtCompact(amt)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Klasifikasi checkboxes */}
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Klasifikasi</p>
            <div className="border border-gray-200 rounded-lg bg-gray-50 flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center px-2 py-1 bg-slate-100 border-b border-gray-200 flex-shrink-0">
                <span className="flex-1 text-[8.5px] font-semibold text-slate-500 uppercase">Klasifikasi</span>
                <span className="text-[8.5px] font-semibold text-slate-500 uppercase">Amount</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                {allKlasifikasi.map(k => {
                  const color     = klasifikasiTotals.find(d => d.label === k)?.color ?? '#94a3b8';
                  const amt       = klasifikasiTotals.find(d => d.label === k)?.value ?? 0;
                  const isChecked = filterKlasifikasi.size === 0 || filterKlasifikasi.has(k);
                  return (
                    <label key={k}
                      className="flex items-center gap-2 px-2 py-1 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-blue-50 transition">
                      <input type="checkbox" checked={isChecked}
                        onChange={() => { toggleKlasifikasi(k); setListPage(0); }}
                        className="w-3 h-3" style={{ accentColor: '#2563eb' }} />
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 truncate text-[9.5px] text-slate-700" title={k}>
                        {k.length > 20 ? k.slice(0, 20) + 'â€¦' : k}
                      </span>
                      <span className="text-[8.5px] font-mono text-slate-500 flex-shrink-0">{fmtCompact(amt)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* â”€â”€ Listing table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="mx-4 mb-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">
              LISTING OUTSTANDING SUB AKUN FLUKTUASI
            </p>
            <p className="text-[9px] text-slate-400">
              {listingRows.length.toLocaleString('id-ID')} entri
              {listingTotalPages > 1 && ` Â· Hal ${listPage + 1} / ${listingTotalPages}`}
            </p>
          </div>
          {listingTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <button disabled={listPage === 0}
                onClick={() => setListPage(p => Math.max(0, p - 1))}
                className="text-sm px-2.5 py-0.5 border border-gray-200 rounded bg-gray-50 text-slate-500 disabled:opacity-30 hover:bg-gray-100 transition">
                â€¹
              </button>
              <button disabled={listPage >= listingTotalPages - 1}
                onClick={() => setListPage(p => Math.min(listingTotalPages - 1, p + 1))}
                className="text-sm px-2.5 py-0.5 border border-gray-200 rounded bg-gray-50 text-slate-500 disabled:opacity-30 hover:bg-gray-100 transition">
                â€º
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                {['#','Sub Akun','Kode Akun','Klasifikasi','Total Amount','Jml Periode'].map(h => (
                  <th key={h} style={{
                    padding: '7px 12px',
                    textAlign: h === 'Total Amount' || h === 'Jml Periode' ? 'right' : 'left',
                    color: '#bfdbfe',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    whiteSpace: 'nowrap',
                    fontSize: 9,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listingPage.map((row, ri) => {
                const globalRi = listPage * LIST_PAGE_SIZE + ri;
                const isPos    = row.total >= 0;
                const color    = row.subGroup?.color ?? '#64748b';
                return (
                  <tr key={ri}
                    className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                    style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="px-3 py-1.5 text-slate-400">{globalRi + 1}.</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold font-mono"
                        style={{ backgroundColor: color + '18', color }}>
                        {row.subGroup?.label ?? '-'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono font-semibold text-blue-600">{row.accountCode}</td>
                    <td className="px-3 py-1.5 text-slate-600 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
                      title={row.klasifikasi}>{row.klasifikasi}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold"
                      style={{ color: isPos ? '#16a34a' : '#dc2626' }}>
                      {fmtFull(row.total)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400">{row.periodes}</td>
                  </tr>
                );
              })}
              {listingPage.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">Tidak ada data sesuai filter</td>
                </tr>
              )}
            </tbody>
            {listingPage.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-gray-200">
                  <td colSpan={4} className="px-3 py-1.5 font-bold text-slate-600 text-xs">TOTAL (filtered)</td>
                  <td className="px-3 py-1.5 text-right font-mono font-extrabold text-sm"
                    style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                    {fmtFull(totalFiltered)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-400 text-xs">{filtered.length} records</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  );
}
