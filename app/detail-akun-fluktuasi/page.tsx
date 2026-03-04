'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw, Search, TrendingUp, Layers, Filter, List, BarChart3 } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';

const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });
const Header  = dynamic(() => import('../components/Header'),  { ssr: false });

// --- Types -------------------------------------------------------------------
type AkunPeriodeRecord = {
  id?: number;
  accountCode: string;
  periode: string;
  amount: number;
  klasifikasi: string;
  remark: string;
};

// --- Helpers -----------------------------------------------------------------
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

const PALETTE = [
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#ea580c','#0891b2','#15803d','#9333ea','#ca8a04',
  '#4f46e5','#e11d48','#0d9488','#b45309','#6d28d9',
  '#be123c','#065f46','#1e40af','#92400e','#4338ca',
];

const SUB_GROUP_PREFIXES: { prefix: string; label: string; color: string }[] = [
  { prefix: '713',  label: '71300000', color: '#2563eb' },
  { prefix: '714',  label: '71400000', color: '#16a34a' },
  { prefix: '7156', label: '71400000', color: '#16a34a' },
  { prefix: '715',  label: '71510000', color: '#d97706' },
  { prefix: '716',  label: '71600000', color: '#7c3aed' },
];
const subGroupForCode = (code: string) =>
  SUB_GROUP_PREFIXES.find(g => code.startsWith(g.prefix));

// --- Animated Counter Hook --------------------------------------------------
function useAnimatedCounter(target: number, deps: unknown[] = []) {
  const displayRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = displayRef.current;
    if (!el) return;
    const proxy = { value: 0 };
    animate(proxy, {
      value: target,
      duration: 1200,
      ease: 'easeOutExpo',
      onUpdate: () => {
        el.textContent = fmtFull(Math.round(proxy.value));
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
  return displayRef;
}

// --- Donut Chart with anime.js slice animation --------------------------------
function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const paths = svgRef.current?.querySelectorAll('path[data-slice]');
    if (!paths || paths.length === 0) return;
    animate(paths, {
      opacity: [0, 1],
      scale: [0.6, 1],
      duration: 700,
      delay: stagger(55),
      ease: 'easeOutBack',
    });
  }, [data]);

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
    <svg ref={svgRef} viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="#f1f5f9" />
      {slices.map((s, i) => (
        <path
          key={i}
          data-slice="true"
          d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)}
          fill={s.color}
          style={{ transformOrigin: `${cx}px ${cy}px`, opacity: 0 }}
        />
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

// --- Trend Chart with GSAP draw animation ------------------------------------
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  const polylineRef = useRef<SVGPolylineElement>(null);
  const polygonRef  = useRef<SVGPolygonElement>(null);

  useEffect(() => {
    const line = polylineRef.current;
    const area = polygonRef.current;
    if (!line || !area) return;
    const totalLen = (line.getTotalLength ? line.getTotalLength() : 800);
    gsap.set(line, { strokeDasharray: totalLen, strokeDashoffset: totalLen, opacity: 1 });
    gsap.set(area, { opacity: 0 });
    gsap.to(line,  { strokeDashoffset: 0, duration: 1.4, ease: 'power3.out', delay: 0.1 });
    gsap.to(area,  { opacity: 1, duration: 0.8, delay: 0.8, ease: 'power2.out' });
  }, [data]);

  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-slate-400 text-xs">Butuh lebih dari 1 periode</span>
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
  const areaPoints = [
    `${toX(0)},${H - 14}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${H - 14}`,
  ].join(' ');
  const step = data.length > 12 ? Math.ceil(data.length / 10) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <defs>
        <linearGradient id="trendGradAkun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
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
      <polygon ref={polygonRef} points={areaPoints} fill="url(#trendGradAkun)" style={{ opacity: 0 }} />
      <polyline ref={polylineRef} points={pts} fill="none" stroke="#2563eb" strokeWidth={2.2} strokeLinejoin="round" style={{ opacity: 0 }} />
      {data.map((d, i) => {
        const showDot   = data.length <= 30;
        const showLabel = i % step === 0 || i === data.length - 1;
        return (
          <g key={i}>
            {showDot && (
              <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#2563eb" stroke="white" strokeWidth={1}
                style={{ opacity: 0, animation: `fadeInDot 0.3s ease ${0.8 + i * 0.02}s forwards` }} />
            )}
            {showLabel && (
              <text x={toX(i)} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize={7}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      <style>{`@keyframes fadeInDot { from { opacity:0; transform:scale(0); transform-box:fill-box; transform-origin:center; } to { opacity:1; transform:scale(1); } }`}</style>
    </svg>
  );
}

// --- Skeleton Loading State --------------------------------------------------
function PageSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Filter pills skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-28 rounded-full" />
        <div className="ml-auto"><Skeleton className="h-7 w-28 rounded-lg" /></div>
      </div>
      {/* 3-col grid skeleton */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[280px_1fr_270px]">
        {/* Donut */}
        <div className="bg-white rounded-xl border p-4 flex flex-col gap-3 shadow-sm">
          <Skeleton className="h-3 w-44 mx-auto rounded" />
          <div className="mx-auto relative">
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-2.5 w-2.5 rounded-sm shrink-0" />
                <Skeleton className="h-2.5 flex-1 rounded" />
                <Skeleton className="h-2.5 w-14 rounded" />
              </div>
            ))}
          </div>
        </div>
        {/* Center */}
        <div className="flex flex-col gap-3">
          <div className="bg-white rounded-xl border p-4 shadow-sm">
            <Skeleton className="h-3 w-52 mb-3 rounded" />
            <div className="flex gap-1 mb-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-10 rounded" />)}
            </div>
            <Skeleton className="h-[130px] w-full rounded-lg" />
          </div>
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <div className="grid grid-cols-2 divide-x divide-slate-100">
              {Array.from({ length: 2 }).map((_, ii) => (
                <div key={ii} className="p-3 space-y-2.5">
                  <Skeleton className="h-3 w-32 rounded" />
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex gap-2">
                      <Skeleton className="h-3 flex-1 rounded" />
                      <Skeleton className="h-3 w-16 rounded" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Filter */}
        <div className="bg-white rounded-xl border p-4 space-y-3 shadow-sm">
          <Skeleton className="h-3 w-12 mx-auto rounded" />
          <Skeleton className="h-7 w-full rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded" />
                <Skeleton className="h-2.5 w-2 rounded-sm" />
                <Skeleton className="h-2.5 flex-1 rounded" />
                <Skeleton className="h-2.5 w-10 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Table skeleton */}
      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b bg-slate-50/60">
          <Skeleton className="h-3 w-52 rounded" />
          <Skeleton className="h-2.5 w-24 mt-1.5 rounded" />
        </div>
        <div className="p-3 space-y-2">
          <div className="h-7 rounded-lg bg-gradient-to-r from-[#1e3a5f] to-[#1e40af] opacity-80" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-center py-1">
              <Skeleton className="h-3 w-4 rounded" />
              <Skeleton className="h-5 w-20 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-3 w-8 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ----------------------------------------------------------
export default function DetailAkunFluktuasiPage() {
  const [records, setRecords]                   = useState<AkunPeriodeRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  // Filters
  const [selectedYear,      setSelectedYear]      = useState<string>('all');
  const [searchAkun,        setSearchAkun]        = useState('');
  const [filterAkun,        setFilterAkun]        = useState<Set<string>>(new Set());
  const [filterKlasifikasi, setFilterKlasifikasi] = useState<Set<string>>(new Set());

  // Listing
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 50;

  // Animation refs
  const pillsRef     = useRef<HTMLDivElement>(null);
  const donutCardRef = useRef<HTMLDivElement>(null);
  const centerColRef = useRef<HTMLDivElement>(null);
  const filterColRef = useRef<HTMLDivElement>(null);
  const tableRef     = useRef<HTMLDivElement>(null);
  const resetBtnRef  = useRef<HTMLButtonElement>(null);
  const akunListRef  = useRef<HTMLDivElement>(null);
  const klasListRef  = useRef<HTMLDivElement>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    fetch('/api/fluktuasi/akun-periodes')
      .then(r => r.json())
      .then(data => { if (data.success && Array.isArray(data.data)) setRecords(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── GSAP page-entry after data loads ────────────────────────────────────
  useEffect(() => {
    if (loading || records.length === 0) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        pillsRef.current,
        { opacity: 0, x: -16 },
        { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }
      );
      gsap.fromTo(
        [donutCardRef.current, centerColRef.current, filterColRef.current],
        { opacity: 0, y: 36, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, stagger: 0.13, ease: 'power3.out', delay: 0.15 }
      );
      gsap.fromTo(
        tableRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out', delay: 0.52 }
      );
    });
    return () => ctx.revert();
  }, [loading, records.length]);

  // ── Animate akun filter items when search or selection changes ───────────
  useEffect(() => {
    if (!akunListRef.current) return;
    const items = akunListRef.current.querySelectorAll('.akun-item');
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateX: [10, 0],
      duration: 260,
      delay: stagger(22),
      ease: 'easeOutExpo',
    });
  }, [filterAkun, searchAkun]);

  // ── Animate klasifikasi items ────────────────────────────────────────────
  useEffect(() => {
    if (!klasListRef.current) return;
    const items = klasListRef.current.querySelectorAll('.klas-item');
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1],
      translateX: [8, 0],
      duration: 240,
      delay: stagger(20),
      ease: 'easeOutExpo',
    });
  }, [filterKlasifikasi]);

  // ── Animate table rows on page/filter change ─────────────────────────────
  useEffect(() => {
    if (!tableBodyRef.current) return;
    const rows = tableBodyRef.current.querySelectorAll('tr');
    if (!rows.length) return;
    animate(rows, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 250,
      delay: stagger(16),
      ease: 'easeOutExpo',
    });
  }, [listPage, filterAkun, filterKlasifikasi, selectedYear]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const years = useMemo(() => {
    const s = new Set(records.map(r => r.periode.split('.')[0]));
    return [...s].sort();
  }, [records]);

  const allAkunCodes = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + Math.abs(r.amount)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [records]);

  const codeColorMap = useMemo(
    () => new Map(allAkunCodes.map((c, i) => [c, PALETTE[i % PALETTE.length]])),
    [allAkunCodes],
  );

  const allKlasifikasi = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => {
      const raw = r.klasifikasi || '(Tanpa Klasifikasi)';
      raw.split(';').map((p: string) => p.trim()).filter(Boolean).forEach((k: string) => s.add(k));
    });
    return [...s].sort();
  }, [records]);

  const filteredAkunOptions = useMemo(() =>
    allAkunCodes.filter(c => c.toLowerCase().includes(searchAkun.toLowerCase())),
  [allAkunCodes, searchAkun]);

  const filtered = useMemo(() => records.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterAkun.size > 0 && !filterAkun.has(r.accountCode)) return false;
    if (filterKlasifikasi.size > 0) {
      const parts = (r.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((p: string) => p.trim()).filter(Boolean);
      if (!parts.some((k: string) => filterKlasifikasi.has(k))) return false;
    }
    return true;
  }), [records, selectedYear, filterAkun, filterKlasifikasi]);

  const totalFiltered = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const accountTotalsMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + r.amount));
    return m;
  }, [filtered]);

  const topAccounts = useMemo(() => {
    const entries = [...accountTotalsMap.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const top14   = entries.slice(0, 14);
    const others  = entries.slice(14);
    const othersTotal = others.reduce((s, [, v]) => s + v, 0);
    const result = top14.map(([code, value]) => ({
      label: code,
      value,
      color: codeColorMap.get(code) ?? '#94a3b8',
    }));
    if (others.length > 0) result.push({ label: `+${others.length} lainnya`, value: othersTotal, color: '#cbd5e1' });
    return result.filter(d => d.value !== 0);
  }, [accountTotalsMap, codeColorMap]);

  const donutTotal = useMemo(() => topAccounts.reduce((s, d) => s + Math.abs(d.value), 0), [topAccounts]);

  const byPeriode = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.periode, (m.get(r.periode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
  }, [filtered]);

  const accountSummaryRows = useMemo(() => {
    return [...accountTotalsMap.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([code, total]) => ({ code, total, color: codeColorMap.get(code) ?? '#94a3b8' }));
  }, [accountTotalsMap, codeColorMap]);

  const klasifikasiTotalsMap = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const parts = (r.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((p: string) => p.trim()).filter(Boolean);
      const share = r.amount / parts.length;
      const activeParts = filterKlasifikasi.size > 0
        ? parts.filter((k: string) => filterKlasifikasi.has(k))
        : parts;
      activeParts.forEach((k: string) => m.set(k, (m.get(k) ?? 0) + share));
    });
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  }, [filtered, filterKlasifikasi]);

  const klasifikasiLookup = useMemo(
    () => new Map(klasifikasiTotalsMap.map(d => [d.label, d])),
    [klasifikasiTotalsMap],
  );

  const listingRows = useMemo(() => {
    const m = new Map<string, { accountCode: string; klasifikasi: string; klasifikasiParts: Set<string>; total: number; periodes: number }>();
    filtered.forEach(r => {
      const key = r.accountCode;
      const parts = (r.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((p: string) => p.trim()).filter(Boolean);
      const ex = m.get(key) ?? { accountCode: r.accountCode, klasifikasi: '', klasifikasiParts: new Set<string>(), total: 0, periodes: 0 };
      parts.forEach(p => ex.klasifikasiParts.add(p));
      m.set(key, { ...ex, total: ex.total + r.amount, periodes: ex.periodes + 1 });
    });
    return [...m.values()]
      .map(row => ({ ...row, klasifikasi: [...row.klasifikasiParts].join('; ') }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [filtered]);

  const listingTotalPages = useMemo(
    () => Math.ceil(listingRows.length / LIST_PAGE_SIZE),
    [listingRows],
  );
  const listingPage = useMemo(
    () => listingRows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE),
    [listingRows, listPage],
  );

  const latestPeriode = useMemo(() => {
    const all = [...new Set(records.map(r => r.periode))].sort();
    return all.length > 0 ? periodeToLabel(all[all.length - 1]) : '-';
  }, [records]);

  const resetFilters = useCallback(() => {
    if (resetBtnRef.current) {
      animate(resetBtnRef.current, {
        translateX: [0, -6, 6, -4, 4, 0],
        duration: 380,
        ease: 'easeInOutSine',
      });
    }
    setSelectedYear('all');
    setSearchAkun('');
    setFilterAkun(new Set());
    setFilterKlasifikasi(new Set());
    setListPage(0);
  }, []);

  const toggleAkun = useCallback((code: string) => setFilterAkun(prev => {
    const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n;
  }), []);

  const toggleKlasifikasi = useCallback((k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  }), []);

  // Animated total counter
  const counterRef = useAnimatedCounter(totalFiltered, [totalFiltered]);

  // ── Shell ────────────────────────────────────────────────────────────────
  const shell = (content: React.ReactNode) => (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-100">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">
        <Header
          title="Dashboard Per Akun Fluktuasi"
          subtitle={`per ${latestPeriode}`}
          onMenuClick={() => setMobileSidebar(true)}
        />
        {content}
      </div>
    </div>
  );

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) return shell(<PageSkeleton />);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (records.length === 0) return shell(
    <div className="flex-1 flex items-center justify-center p-8">
      <Card className="max-w-sm w-full text-center shadow-lg border-0 bg-white/80 backdrop-blur">
        <CardContent className="pt-8 pb-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <BarChart3 className="w-8 h-8 text-blue-400" />
          </div>
          <p className="text-slate-700 font-semibold text-base">Belum ada data fluktuasi</p>
          <p className="text-slate-400 text-sm mt-1">
            Upload data di halaman <strong className="text-blue-600">Fluktuasi OI/EXP</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────
  return shell(
    <div className="flex-1 overflow-y-auto">

      {/* ── Filter summary + reset ─────────────────────────────────── */}
      <div ref={pillsRef} className="flex items-center justify-between px-4 pt-3 pb-1 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Filter aktif:</span>
          <Badge variant="outline" className="text-[9px] px-2 py-0.5 h-5 bg-blue-50 text-blue-700 border-blue-200 font-semibold">
            {filterAkun.size > 0 ? `${filterAkun.size} akun` : 'Semua akun'}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-2 py-0.5 h-5 bg-purple-50 text-purple-700 border-purple-200 font-semibold">
            {filterKlasifikasi.size > 0 ? `${filterKlasifikasi.size} klasifikasi` : 'Semua klasifikasi'}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-2 py-0.5 h-5 bg-slate-50 text-slate-600 border-slate-200 font-semibold">
            {allAkunCodes.length} kode akun total
          </Badge>
          {selectedYear !== 'all' && (
            <Badge variant="outline" className="text-[9px] px-2 py-0.5 h-5 bg-amber-50 text-amber-700 border-amber-200 font-semibold">
              Tahun {selectedYear}
            </Badge>
          )}
        </div>
        <Button
          ref={resetBtnRef}
          onClick={resetFilters}
          size="sm"
          className="h-7 px-3 text-[10px] font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm gap-1.5 transition-all duration-200 active:scale-95 border-0"
        >
          <RotateCcw size={11} className="shrink-0" /> Reset Filter
        </Button>
      </div>

      {/* ── 3-col top panel ────────────────────────────────────────── */}
      <div className="grid gap-3 px-4 pt-1 pb-3 grid-cols-1 lg:grid-cols-[280px_1fr_270px]">

        {/* ── LEFT – Donut ─────────────────────────────────────────── */}
        <div ref={donutCardRef} style={{ opacity: 0 }}>
          <Card className="h-full border-0 shadow-md bg-white/90 backdrop-blur-sm hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                <Layers size={11} className="text-blue-500" />
                DISTRIBUSI PER KODE AKUN
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 flex flex-col items-center gap-2">
              <DonutChart data={topAccounts} total={donutTotal} />
              <div className="w-full space-y-1 overflow-y-auto" style={{ maxHeight: 200 }}>
                {topAccounts.slice(0, 12).map((d, i) => {
                  const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100).toFixed(1) : '0.0';
                  return (
                    <div key={i}
                      className="flex items-center gap-2 cursor-pointer hover:bg-blue-50/60 rounded-md px-1.5 py-0.5 transition-all duration-150 group"
                      onClick={() => {
                        if (!d.label.startsWith('+')) { toggleAkun(d.label); setListPage(0); }
                      }}>
                      <span className="flex-shrink-0 rounded-sm transition-transform duration-150 group-hover:scale-125"
                        style={{ width: 9, height: 9, backgroundColor: d.color }} />
                      <span className="flex-1 text-[10px] font-mono text-slate-600 truncate">{d.label}</span>
                      <span className="text-[10px] font-bold font-mono flex-shrink-0"
                        style={{ color: d.value >= 0 ? '#16a34a' : '#dc2626' }}>
                        {fmtCompact(d.value)}
                      </span>
                      <span className="text-[9px] text-slate-400 w-9 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  );
                })}
                {topAccounts.length > 12 && (
                  <div className="flex items-center gap-2 px-1.5">
                    <span className="flex-shrink-0 rounded-sm" style={{ width: 9, height: 9, backgroundColor: '#cbd5e1' }} />
                    <span className="flex-1 text-[10px] font-mono text-slate-400 italic">{topAccounts[topAccounts.length - 1]?.label}</span>
                    <span className="text-[10px] font-bold font-mono text-slate-400">
                      {fmtCompact(topAccounts[topAccounts.length - 1]?.value ?? 0)}
                    </span>
                  </div>
                )}
                <div className="border-t border-slate-100 pt-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-600">Total keseluruhan</span>
                  <span className="text-[11px] font-extrabold font-mono"
                    style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                    <span ref={counterRef}>{fmtFull(totalFiltered)}</span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── CENTER – Trend + tables ──────────────────────────────── */}
        <div ref={centerColRef} className="flex flex-col gap-3" style={{ opacity: 0 }}>

          {/* Trend chart card */}
          <Card className="border-0 shadow-md bg-white/90 backdrop-blur-sm hover:shadow-lg transition-shadow duration-300">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp size={11} className="text-blue-500" />
                  TREN TOTAL FLUKTUASI PER PERIODE
                </p>
                <div className="flex items-center gap-1 text-[9px] text-slate-400">
                  <span className="inline-block w-6 h-0.5 bg-blue-600 rounded" />
                  Amount Outstanding
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <button
                  onClick={() => setSelectedYear('all')}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{ backgroundColor: selectedYear === 'all' ? '#2563eb' : '#f1f5f9', color: selectedYear === 'all' ? 'white' : '#64748b' }}>
                  Semua
                </button>
                {years.map(yr => (
                  <button key={yr} onClick={() => setSelectedYear(yr)}
                    className="px-2 py-0.5 rounded text-[9px] font-semibold transition-all duration-200 hover:scale-105 active:scale-95"
                    style={{ backgroundColor: selectedYear === yr ? '#2563eb' : '#f1f5f9', color: selectedYear === yr ? 'white' : '#64748b' }}>
                    {yr}
                  </button>
                ))}
              </div>
              <div style={{ height: 130 }}>
                <TrendChart data={byPeriode} />
              </div>
            </CardContent>
          </Card>

          {/* Side-by-side summary tables */}
          <Card className="border-0 shadow-md bg-white/90 backdrop-blur-sm overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2">

              {/* Top Accounts table */}
              <div className="border-r border-slate-100">
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <BarChart3 size={9} className="text-blue-500" /> Top 10 Kode Akun
                  </p>
                </div>
                <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                      <th className="px-3 py-1.5 text-left text-[8.5px] font-semibold uppercase" style={{ color: '#bfdbfe' }}>Kode Akun</th>
                      <th className="px-3 py-1.5 text-left text-[8.5px] font-semibold uppercase" style={{ color: '#bfdbfe' }}>Sub Akun</th>
                      <th className="px-3 py-1.5 text-right text-[8.5px] font-semibold uppercase" style={{ color: '#bfdbfe' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountSummaryRows.map(({ code, total, color }, i) => {
                      const sg = subGroupForCode(code);
                      return (
                        <tr key={i}
                          className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-blue-50/50 transition-colors duration-100`}
                          style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td className="px-3 py-1.5 font-mono font-semibold" style={{ color }}>
                            {code}
                          </td>
                          <td className="px-3 py-1.5">
                            {sg && (
                              <span className="inline-block px-1 py-0.5 rounded text-[8.5px] font-mono font-bold"
                                style={{ backgroundColor: sg.color + '18', color: sg.color }}>
                                {sg.label}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-bold"
                            style={{ color: total >= 0 ? '#16a34a' : '#dc2626' }}>
                            {fmtFull(total)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-gray-200 bg-slate-50">
                      <td colSpan={2} className="px-3 py-1.5 font-bold text-slate-600 text-[10px]">Total keseluruhan</td>
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
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Layers size={9} className="text-purple-500" /> Klasifikasi
                  </p>
                </div>
                <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                      <th className="px-3 py-1.5 text-left text-[8.5px] font-semibold uppercase" style={{ color: '#bfdbfe' }}>Klasifikasi</th>
                      <th className="px-3 py-1.5 text-right text-[8.5px] font-semibold uppercase" style={{ color: '#bfdbfe' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {klasifikasiTotalsMap.slice(0, 7).map((d, i) => (
                      <tr key={i}
                        className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-purple-50/50 transition-colors duration-100`}
                        style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="px-3 py-1.5 text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <span className="flex-shrink-0 rounded-sm w-2 h-2" style={{ backgroundColor: d.color }} />
                            <span className="truncate max-w-[140px]" title={d.label}>{d.label}</span>
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
          </Card>
        </div>

        {/* ── RIGHT – Filter ────────────────────────────────────────── */}
        <div ref={filterColRef} style={{ opacity: 0 }}>
          <Card className="h-full border-0 shadow-md bg-white/90 backdrop-blur-sm hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                <Filter size={10} className="text-blue-500" /> FILTER
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 flex flex-col gap-3">

              {/* Akun filter with search */}
              <div className="flex flex-col flex-1 min-h-0">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Kode Akun</p>
                <div className="relative mb-1.5">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="Cari kode akun..."
                    value={searchAkun}
                    onChange={e => setSearchAkun(e.target.value)}
                    className="pl-7 h-7 text-[10px] border-slate-200 bg-slate-50/80 focus:bg-white focus:border-blue-400 transition-colors duration-200"
                  />
                </div>
                <div className="border border-slate-200 rounded-lg bg-slate-50/60 flex flex-col overflow-hidden flex-1 shadow-inner">
                  <div className="flex items-center px-2 py-1.5 bg-slate-100/80 border-b border-slate-200 flex-shrink-0">
                    <span className="flex-1 text-[8.5px] font-bold text-slate-500 uppercase tracking-wide">Akun</span>
                    <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-wide">Amount</span>
                  </div>
                  <div ref={akunListRef} className="overflow-y-auto flex-1" style={{ maxHeight: 200 }}>
                    {filteredAkunOptions.length === 0 && (
                      <p className="text-center py-3 text-[9px] text-slate-400 italic">Tidak ditemukan</p>
                    )}
                    {filteredAkunOptions.map(code => {
                      const amt       = accountTotalsMap.get(code) ?? 0;
                      const isChecked = filterAkun.size === 0 || filterAkun.has(code);
                      const color     = codeColorMap.get(code) ?? '#94a3b8';
                      return (
                        <label key={code}
                          className="akun-item flex items-center gap-2 px-2 py-1 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-blue-50/70 transition-colors duration-150">
                          <input type="checkbox" checked={isChecked}
                            onChange={() => { toggleAkun(code); setListPage(0); }}
                            className="w-3 h-3 rounded" style={{ accentColor: color }} />
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="flex-1 text-[10px] font-mono text-slate-700">{code}</span>
                          <span className="text-[8.5px] font-mono text-slate-400 flex-shrink-0">{fmtCompact(amt)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Klasifikasi filter */}
              <div className="flex flex-col min-h-0">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Klasifikasi</p>
                <div className="border border-slate-200 rounded-lg bg-slate-50/60 overflow-hidden shadow-inner">
                  <div className="flex items-center px-2 py-1.5 bg-slate-100/80 border-b border-slate-200">
                    <span className="flex-1 text-[8.5px] font-bold text-slate-500 uppercase tracking-wide">Klasifikasi</span>
                    <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-wide">Amount</span>
                  </div>
                  <div ref={klasListRef} className="overflow-y-auto" style={{ maxHeight: 150 }}>
                    {allKlasifikasi.map(k => {
                      const entry     = klasifikasiLookup.get(k);
                      const color     = entry?.color ?? '#94a3b8';
                      const amt       = entry?.value ?? 0;
                      const isChecked = filterKlasifikasi.size === 0 || filterKlasifikasi.has(k);
                      return (
                        <label key={k}
                          className="klas-item flex items-center gap-2 px-2 py-1 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-purple-50/70 transition-colors duration-150">
                          <input type="checkbox" checked={isChecked}
                            onChange={() => { toggleKlasifikasi(k); setListPage(0); }}
                            className="w-3 h-3 rounded" style={{ accentColor: '#7c3aed' }} />
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="flex-1 truncate text-[9.5px] text-slate-700" title={k}>
                            {k.length > 22 ? k.slice(0, 22) + '...' : k}
                          </span>
                          <span className="text-[8.5px] font-mono text-slate-400 flex-shrink-0">{fmtCompact(amt)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Listing table ─────────────────────────────────────────── */}
      <div ref={tableRef} className="mx-4 mb-4" style={{ opacity: 0 }}>
        <Card className="border-0 shadow-md bg-white/90 backdrop-blur-sm overflow-hidden hover:shadow-lg transition-shadow duration-300">

          <div className="border-b border-slate-100 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60">
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                <List size={10} className="text-blue-500" />
                LISTING OUTSTANDING PER KODE AKUN
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">
                {listingRows.length.toLocaleString('id-ID')} entri
                {listingTotalPages > 1 && ` · Hal ${listPage + 1} / ${listingTotalPages}`}
              </p>
            </div>
            {listingTotalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  disabled={listPage === 0}
                  onClick={() => setListPage(p => Math.max(0, p - 1))}
                  className="h-6 w-6 p-0 text-slate-500 disabled:opacity-30 transition-all duration-150 active:scale-90">
                  &#8249;
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={listPage >= listingTotalPages - 1}
                  onClick={() => setListPage(p => Math.min(listingTotalPages - 1, p + 1))}
                  className="h-6 w-6 p-0 text-slate-500 disabled:opacity-30 transition-all duration-150 active:scale-90">
                  &#8250;
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                  {['#','Kode Akun','Sub Akun','Klasifikasi','Total Amount','Jml Periode'].map(h => (
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
              <tbody ref={tableBodyRef}>
                {listingPage.map((row, ri) => {
                  const globalRi = listPage * LIST_PAGE_SIZE + ri;
                  const isPos    = row.total >= 0;
                  const color    = codeColorMap.get(row.accountCode) ?? '#94a3b8';
                  const sg       = subGroupForCode(row.accountCode);
                  return (
                    <tr key={ri}
                      className={`${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-blue-50/40 transition-colors duration-100 cursor-default`}
                      style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="px-3 py-1.5 text-slate-400 text-[9px]">{globalRi + 1}.</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold font-mono transition-all duration-150 hover:scale-105"
                          style={{ backgroundColor: color + '18', color }}>
                          {row.accountCode}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {sg ? (
                          <span className="inline-block px-1 py-0.5 rounded text-[8.5px] font-mono font-bold"
                            style={{ backgroundColor: sg.color + '18', color: sg.color }}>
                            {sg.label}
                          </span>
                        ) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-1.5 max-w-[200px]">
                        <div className="flex flex-wrap gap-0.5">
                          {(row.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((k, ki) => (
                            <span key={ki} className="inline-block px-1 py-0.5 rounded text-[8px] font-medium bg-slate-100 text-slate-600 border border-slate-200 transition-all duration-150 hover:bg-blue-50 hover:border-blue-200">{k.trim()}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold"
                        style={{ color: isPos ? '#16a34a' : '#dc2626' }}>
                        {fmtFull(row.total)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-400 text-[9px]">{row.periodes}</td>
                    </tr>
                  );
                })}
                {listingPage.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                      <div className="flex flex-col items-center gap-2">
                        <List size={20} className="text-slate-300" />
                        Tidak ada data sesuai filter
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {listingPage.length > 0 && (
                <tfoot>
                  <tr className="bg-gradient-to-r from-slate-50 to-blue-50/30 border-t border-gray-200">
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
        </Card>
      </div>

    </div>
  );
}
