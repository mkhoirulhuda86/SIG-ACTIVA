'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw, TrendingUp, SlidersHorizontal, BarChart3, Layers } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Separator } from '../components/ui/separator';

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
  code: string;    // e.g. "71510000"
  prefix: string;  // leading digits to match, e.g. "7151"
  label: string;
  color: string;
};

// Fixed 4 sub-akun groups (3-char prefix to match all child accounts)
const SUB_GROUPS: SubGroup[] = [
  { code: '71300000', prefix: '713', label: '71300000', color: '#2563eb' },
  { code: '71400000', prefix: '714', label: '71400000', color: '#16a34a' },
  { code: '71510000', prefix: '715', label: '71510000', color: '#d97706' },
  { code: '71600000', prefix: '716', label: '71600000', color: '#7c3aed' },
];
// Prefix overrides: more specific prefixes that redirect to a different group than the 3-char prefix would imply
const PREFIX_OVERRIDES: { prefix: string; code: string }[] = [
  { prefix: '7156', code: '71400000' }, // 7156xxxx masuk 71400000
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

// Cached formatter — avoids allocating a new Intl instance on every call
const _fmtFull = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const fmtFull = (n: number): string => _fmtFull.format(n);

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
// Pre-processed record: group + parts cached at load time
type ProcessedRecord = AkunPeriodeRecord & {
  _group: SubGroup;
  _parts: string[];
};

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || total === 0) return;
    const paths = svgRef.current.querySelectorAll('path[data-slice]');
    if (!paths.length) return;
    animate(paths, {
      opacity: [0, 1],
      scale: [0.7, 1],
      duration: 650,
      delay: stagger(70, { start: 60 }),
      ease: 'easeOutElastic(1, .6)',
    });
    const texts = svgRef.current.querySelectorAll('text');
    animate(texts, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 400,
      delay: stagger(60, { start: 450 }),
      ease: 'easeOutExpo',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

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
    <svg ref={svgRef} viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0, overflow: 'visible' }}>
      <circle cx={cx} cy={cy} r={R} fill="#f1f5f9" />
      {slices.map((s, i) => (
        <path
          key={i}
          data-slice="true"
          d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)}
          fill={s.color}
          style={{ transformOrigin: `${cx}px ${cy}px`, cursor: 'pointer' }}
          onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.07, duration: 0.2, transformOrigin: `${cx}px ${cy}px`, ease: 'power2.out' })}
          onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1.0, duration: 0.2, transformOrigin: `${cx}px ${cy}px`, ease: 'power2.out' })}
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

// â”€â”€â”€ Trend chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  const polyRef = useRef<SVGPolylineElement>(null);
  const areaRef = useRef<SVGPolygonElement>(null);
  const dotsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!polyRef.current || data.length < 2) return;
    const line = polyRef.current;
    const len = line.getTotalLength?.() ?? 800;
    gsap.fromTo(line,
      { strokeDasharray: len, strokeDashoffset: len, opacity: 1 },
      { strokeDashoffset: 0, duration: 1.1, ease: 'power3.inOut', delay: 0.1 }
    );
    if (areaRef.current) {
      gsap.fromTo(areaRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.7 }
      );
    }
    if (dotsRef.current) {
      const dots = dotsRef.current.querySelectorAll('circle');
      animate(dots, {
        opacity: [0, 1],
        scale: [0, 1],
        duration: 300,
        delay: stagger(30, { start: 900 }),
        ease: 'easeOutBack',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length]);

  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-slate-400 text-xs">Butuh &ge; 2 periode</span>
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
      <polygon ref={areaRef} points={area} fill="url(#trendGrad)" style={{ opacity: 0 }} />
      <polyline ref={polyRef} points={pts} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
      <g ref={dotsRef}>
        {data.map((d, i) => {
          const showDot   = data.length <= 30;
          const showLabel = i % step === 0 || i === data.length - 1;
          return (
            <g key={i}>
              {showDot && (
                <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#2563eb" stroke="white" strokeWidth={1}
                  style={{ opacity: 0, transformOrigin: `${toX(i)}px ${toY(d.value)}px` }} />
              )}
              {showLabel && (
                <text x={toX(i)} y={H - 2} textAnchor="middle" fill="#94a3b8" fontSize={7}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function SubAkunFluktuasiPage() {
  const [records, setRecords]                   = useState<ProcessedRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  // Filters
  const [selectedYear,      setSelectedYear]      = useState<string>('all');
  const [filterSubAkun,     setFilterSubAkun]     = useState<Set<string>>(new Set());
  const [filterKlasifikasi, setFilterKlasifikasi] = useState<Set<string>>(new Set());

  // Listing
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 50;

  // Per-code group cache — persists across renders, cleared on fresh data load
  const groupCache = useRef(new Map<string, SubGroup>());

  // Animation refs
  const pageRef          = useRef<HTMLDivElement>(null);
  const resetBtnRef      = useRef<HTMLButtonElement>(null);
  const donutCardRef     = useRef<HTMLDivElement>(null);
  const trendCardRef     = useRef<HTMLDivElement>(null);
  const tablesCardRef    = useRef<HTMLDivElement>(null);
  const filterCardRef    = useRef<HTMLDivElement>(null);
  const listingCardRef   = useRef<HTMLDivElement>(null);
  const tableBodyRef     = useRef<HTMLTableSectionElement>(null);
  const filterBoxRef     = useRef<HTMLDivElement>(null);
  const subAkunListRef   = useRef<HTMLDivElement>(null);
  const klasiListRef     = useRef<HTMLDivElement>(null);

  // Animate page entrance when data loads
  useEffect(() => {
    if (!pageRef.current) return;
    const cards = [donutCardRef, trendCardRef, tablesCardRef, filterCardRef].map(r => r.current).filter(Boolean);
    gsap.fromTo(pageRef.current,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }
    );
    gsap.fromTo(cards,
      { opacity: 0, y: 32, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.65, ease: 'power3.out', stagger: 0.08, delay: 0.12 }
    );
  }, [loading]);

  // Animate table rows whenever filtered data changes
  useEffect(() => {
    if (!tableBodyRef.current) return;
    const rows = tableBodyRef.current.querySelectorAll('tr');
    animate(rows, {
      opacity: [0, 1],
      translateX: [-10, 0],
      duration: 280,
      delay: stagger(25),
      ease: 'easeOutExpo',
    });
  }, [listPage, filterSubAkun, filterKlasifikasi, selectedYear]);

  // Animate filter sub-akun list on filter change
  useEffect(() => {
    if (!subAkunListRef.current) return;
    const items = subAkunListRef.current.querySelectorAll('label');
    animate(items, {
      opacity: [0, 1],
      translateX: [8, 0],
      duration: 260,
      delay: stagger(30),
      ease: 'easeOutExpo',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSubAkun]);

  // Animate listing card on mount
  useEffect(() => {
    if (!listingCardRef.current) return;
    gsap.fromTo(listingCardRef.current,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.45 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/fluktuasi/akun-periodes', { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (!data.success || !Array.isArray(data.data)) return;
        // Build group cache and pre-process records in one pass
        groupCache.current.clear();
        const resolveGroupFn = (code: string): SubGroup => {
          const cached = groupCache.current.get(code);
          if (cached) return cached;
          let result: SubGroup | undefined;
          for (const ov of PREFIX_OVERRIDES) {
            if (code.startsWith(ov.prefix)) {
              result = SUB_GROUPS.find(s => s.code === ov.code);
              if (result) break;
            }
          }
          if (!result) {
            for (const g of SUB_GROUPS) {
              if (code.startsWith(g.prefix)) { result = g; break; }
            }
          }
          if (!result) {
            const idx = code.charCodeAt(0) % KLASI_PALETTE.length;
            result = { code, prefix: code, label: code, color: KLASI_PALETTE[idx] };
          }
          groupCache.current.set(code, result);
          return result;
        };
        const processed: ProcessedRecord[] = (data.data as AkunPeriodeRecord[]).map(r => ({
          ...r,
          _group: resolveGroupFn(r.accountCode),
          _parts: (r.klasifikasi || '(Tanpa Klasifikasi)')
            .split(';').map((p: string) => p.trim()).filter(Boolean),
        }));
        setRecords(processed);
      })
      .catch((e: unknown) => { if ((e as Error).name !== 'AbortError') console.error(e); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  // â”€â”€ Derived â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // O(n) scan: years, allKlasifikasi, latestPeriode, visibleGroups — all from records
  const { years, allKlasifikasi, latestPeriode, visibleGroups } = useMemo(() => {
    const yearSet    = new Set<string>();
    const klasiSet   = new Set<string>();
    const extraCodes = new Set<string>();
    const extras: SubGroup[] = [];
    let latest = '';
    for (const r of records) {
      yearSet.add(r.periode.split('.')[0]);
      if (r.periode > latest) latest = r.periode;
      r._parts.forEach(k => klasiSet.add(k));
      if (!SUB_GROUPS.some(g => r.accountCode.startsWith(g.prefix)) && !extraCodes.has(r.accountCode)) {
        extraCodes.add(r.accountCode);
        extras.push(r._group);
      }
    }
    return {
      years:          [...yearSet].sort(),
      allKlasifikasi: [...klasiSet].sort(),
      latestPeriode:  latest ? periodeToLabel(latest) : '-',
      visibleGroups:  [...SUB_GROUPS, ...extras.sort((a, b) => a.code.localeCompare(b.code))],
    };
  }, [records]);

  // Single-pass derived: filter + all aggregations in one loop
  const derived = useMemo(() => {
    const groupTotals   = new Map<string, number>();
    visibleGroups.forEach(g => groupTotals.set(g.code, 0));
    const periodeTotals = new Map<string, number>();
    const klasiTotals   = new Map<string, number>();
    type ListEntry = { subGroup: SubGroup; klasifikasiParts: Set<string>; total: number; periodes: number };
    const listMap = new Map<string, ListEntry>();
    let total = 0;

    for (const r of records) {
      if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) continue;
      if (filterSubAkun.size > 0 && !filterSubAkun.has(r._group.code)) continue;
      if (filterKlasifikasi.size > 0 && !r._parts.some(k => filterKlasifikasi.has(k))) continue;

      total += r.amount;
      groupTotals.set(r._group.code, (groupTotals.get(r._group.code) ?? 0) + r.amount);
      periodeTotals.set(r.periode, (periodeTotals.get(r.periode) ?? 0) + r.amount);

      const share = r.amount / r._parts.length;
      const activeParts = filterKlasifikasi.size > 0 ? r._parts.filter(k => filterKlasifikasi.has(k)) : r._parts;
      activeParts.forEach(k => klasiTotals.set(k, (klasiTotals.get(k) ?? 0) + share));

      const ex = listMap.get(r._group.code) ?? { subGroup: r._group, klasifikasiParts: new Set<string>(), total: 0, periodes: 0 };
      r._parts.forEach(p => ex.klasifikasiParts.add(p));
      ex.total += r.amount;
      ex.periodes++;
      listMap.set(r._group.code, ex);
    }

    const filteredByGroup = groupTotals;
    const donutData = visibleGroups
      .map(g => ({ label: g.label, value: filteredByGroup.get(g.code) ?? 0, color: g.color }))
      .filter(d => d.value !== 0);
    const donutTotal = donutData.reduce((s, d) => s + Math.abs(d.value), 0);
    const byPeriode = [...periodeTotals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
    const subAkunTotals = visibleGroups
      .map(g => ({ group: g, total: filteredByGroup.get(g.code) ?? 0 }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const klasifikasiTotals = [...klasiTotals.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: KLASI_PALETTE[i % KLASI_PALETTE.length] }));
    const listingRows = [...listMap.values()]
      .map(row => ({ ...row, klasifikasi: [...row.klasifikasiParts].join('; ') }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const klasifikasiMap = new Map(klasifikasiTotals.map(d => [d.label, d]));

    return { total, filteredByGroup, donutData, donutTotal, byPeriode, subAkunTotals, klasifikasiTotals, listingRows, klasifikasiMap };
  }, [records, selectedYear, filterSubAkun, filterKlasifikasi, visibleGroups]);

  const { total: totalFiltered, filteredByGroup, donutData, donutTotal, byPeriode,
          subAkunTotals, klasifikasiTotals, listingRows, klasifikasiMap } = derived;

  const listingTotalPages = Math.ceil(listingRows.length / LIST_PAGE_SIZE);
  const listingPage = useMemo(
    () => listingRows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE),
    [listingRows, listPage],
  );

  const resetFilters = useCallback(() => {
    if (resetBtnRef.current) {
      animate(resetBtnRef.current.querySelector('svg') ?? resetBtnRef.current, {
        rotate: [0, -360],
        scale: [1, 0.85, 1],
        duration: 550,
        ease: 'easeOutBack',
      });
    }
    setSelectedYear('all');
    setFilterSubAkun(new Set());
    setFilterKlasifikasi(new Set());
    setListPage(0);
  }, []);
  const toggleSubAkun = useCallback((code: string) => setFilterSubAkun(prev => {
    const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n;
  }), []);
  const toggleKlasifikasi = useCallback((k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  }), []);

  // â”€â”€ Shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const shell = (content: React.ReactNode) => (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setMobileSidebar(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">
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
    <div className="flex-1 p-4">
      {/* Skeleton grid */}
      <div className="flex justify-end mb-3">
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[280px_1fr_260px] mb-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-center gap-3">
          <Skeleton className="h-3 w-40 rounded" />
          <Skeleton className="h-[200px] w-[200px] rounded-full" />
          <div className="w-full space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <Skeleton className="h-3 w-48 rounded" />
            <div className="flex gap-1">{[1,2,3].map(i => <Skeleton key={i} className="h-5 w-10 rounded" />)}</div>
            <Skeleton className="h-[130px] w-full rounded-lg" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20 rounded" />
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20 rounded" />
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          <Skeleton className="h-3 w-16 rounded mx-auto" />
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-5 w-full rounded" />)}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2">
        {[...Array(5)].map((_,i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-5 flex-1 rounded" />
            <Skeleton className="h-5 w-24 rounded" />
            <Skeleton className="h-5 w-8 rounded" />
          </div>
        ))}
      </div>
      {/* Centered loading overlay */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center">
        <div className="bg-white/90 backdrop-blur-sm border border-blue-200/60 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
            <div className="absolute inset-0 rounded-full border-4 border-t-blue-600 border-r-blue-300 border-b-transparent border-l-transparent animate-spin" />
            <BarChart3 className="absolute inset-0 m-auto w-6 h-6 text-blue-600" />
          </div>
          <p className="text-slate-700 text-sm font-semibold tracking-wide">Memuat data fluktuasi...</p>
          <div className="flex gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (records.length === 0) return shell(
    <div className="flex-1 flex items-center justify-center p-8 text-center">
      <div className="space-y-3">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center">
          <BarChart3 className="w-8 h-8 text-blue-400" />
        </div>
        <p className="text-slate-600 font-semibold text-lg">Belum ada data fluktuasi</p>
        <p className="text-slate-400 text-sm">Upload data di halaman <strong className="text-blue-600">Fluktuasi OI/EXP</strong></p>
      </div>
    </div>
  );

  return shell(
    <div ref={pageRef} className="flex-1 overflow-y-auto">

      {/* ── Reset button ───────────────────────────────────────────── */}
      <div className="flex justify-end px-4 pt-3">
        <button
          ref={resetBtnRef}
          onClick={resetFilters}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200 active:scale-95 hover:brightness-110 hover:shadow-md"
          style={{ backgroundColor: '#dc2626', color: 'white' }}>
          <RotateCcw size={13} /> Reset Filter
        </button>
      </div>

      {/* ── 3-col top panel ────────────────────────────────────────── */}
      <div className="grid gap-3 px-4 pt-2 pb-3 grid-cols-1 lg:grid-cols-[280px_1fr_260px]">

        {/* LEFT – Donut + legend */}
        <div ref={donutCardRef}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-col transition-shadow hover:shadow-md"
          style={{ opacity: 0 }}>
          <div className="flex items-center justify-center gap-1.5 mb-3">
            <Layers size={12} className="text-slate-400" />
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              DISTRIBUSI SUB AKUN FLUKTUASI
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 flex-1">
            <DonutChart data={donutData} total={donutTotal} />
            <div className="w-full space-y-1.5">
              {donutData.map((d, i) => {
                const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100).toFixed(1) : '0.0';
                return (
                  <div key={i}
                    className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg transition-all duration-150 hover:bg-blue-50 active:scale-[0.98]"
                    onClick={() => { toggleSubAkun(d.label); setListPage(0); }}>
                    <span className="flex-shrink-0 rounded-sm" style={{ width: 10, height: 10, backgroundColor: d.color }} />
                    <span className="flex-1 text-[10px] font-mono text-slate-600">{d.label}</span>
                    <span className="text-[10px] font-bold font-mono"
                      style={{ color: d.value >= 0 ? '#16a34a' : '#dc2626' }}>
                      {fmtCompact(d.value)}
                    </span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 font-mono text-slate-400">{pct}%</Badge>
                  </div>
                );
              })}
              <Separator className="my-1" />
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-slate-600">Total keseluruhan</span>
                <span className="text-[11px] font-extrabold font-mono"
                  style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                  {fmtFull(totalFiltered)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER – Trend chart + tables */}
        <div className="flex flex-col gap-3">

          {/* Trend chart */}
          <div ref={trendCardRef}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 transition-shadow hover:shadow-md"
            style={{ opacity: 0 }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={12} className="text-blue-500" />
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  TREN TOTAL FLUKTUASI PER PERIODE
                </p>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-slate-400">
                <span className="inline-block w-6 h-0.5 bg-blue-600 rounded" />
                Amount Outstanding
              </div>
            </div>
            {/* Year quick filter */}
            <div className="flex flex-wrap gap-1 mb-2">
              <button onClick={() => setSelectedYear('all')}
                className="px-2 py-0.5 rounded text-[9px] font-semibold transition-all duration-150 active:scale-90"
                style={{
                  backgroundColor: selectedYear === 'all' ? '#2563eb' : '#f1f5f9',
                  color: selectedYear === 'all' ? 'white' : '#64748b',
                }}>Semua</button>
              {years.map(yr => (
                <button key={yr} onClick={() => setSelectedYear(yr)}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold transition-all duration-150 active:scale-90"
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
          <div ref={tablesCardRef}
            className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md"
            style={{ opacity: 0 }}>
            <div className="grid grid-cols-1 sm:grid-cols-2">

              {/* Sub Akun table */}
              <div className="border-r border-gray-100">
                <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-blue-50/40">
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
                      <tr key={i} className={`transition-colors duration-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50 hover:bg-blue-50/60'}`}
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
                <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-blue-50/40">
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
                      <tr key={i} className={`transition-colors duration-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50 hover:bg-blue-50/60'}`}
                        style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="px-3 py-1.5 text-slate-600">
                          <div className="flex items-start gap-1.5">
                            <span className="flex-shrink-0 rounded-sm w-2 h-2 mt-0.5" style={{ backgroundColor: d.color }} />
                            <span className="leading-snug" title={d.label}>{d.label}</span>
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

        {/* RIGHT – Filter panel */}
        <div ref={filterCardRef}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-col gap-3 transition-shadow hover:shadow-md"
          style={{ opacity: 0 }}>
          <div className="flex items-center justify-center gap-1.5">
            <SlidersHorizontal size={11} className="text-slate-400" />
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">FILTER</p>
          </div>

          {/* Sub Akun checkboxes */}
          <div>
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Sub Kode Akun</p>
            <div ref={subAkunListRef} className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
              <div className="flex items-center px-2 py-1 bg-slate-100 border-b border-gray-200">
                <span className="flex-1 text-[8.5px] font-semibold text-slate-500 uppercase">Sub Akun</span>
                <span className="text-[8.5px] font-semibold text-slate-500 uppercase">Amount</span>
              </div>
              {visibleGroups.map(g => {
                const amt       = filteredByGroup.get(g.code) ?? 0;
                const isChecked = filterSubAkun.size === 0 || filterSubAkun.has(g.code);
                return (
                  <label key={g.code}
                    className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-blue-50 transition-colors duration-100">
                    <input type="checkbox" checked={isChecked}
                      onChange={() => { toggleSubAkun(g.code); setListPage(0); }}
                      className="w-3 h-3 rounded" style={{ accentColor: g.color }} />
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="flex-1 text-[10px] font-mono text-slate-700">{g.label}</span>
                    <span className="text-[9px] font-mono text-slate-500">{fmtCompact(amt)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Klasifikasi checkboxes */}
          <div ref={klasiListRef} className="flex-1 flex flex-col min-h-0">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Klasifikasi</p>
            <div className="border border-gray-200 rounded-lg bg-gray-50 flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center px-2 py-1 bg-slate-100 border-b border-gray-200 flex-shrink-0">
                <span className="flex-1 text-[8.5px] font-semibold text-slate-500 uppercase">Klasifikasi</span>
                <span className="text-[8.5px] font-semibold text-slate-500 uppercase">Amount</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                {allKlasifikasi.map(k => {
                  const entry     = klasifikasiMap.get(k);
                  const color     = entry?.color ?? '#94a3b8';
                  const amt       = entry?.value ?? 0;
                  const isChecked = filterKlasifikasi.size === 0 || filterKlasifikasi.has(k);
                  return (
                    <label key={k}
                      className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-blue-50 transition-colors duration-100">
                      <input type="checkbox" checked={isChecked}
                        onChange={() => { toggleKlasifikasi(k); setListPage(0); }}
                        className="w-3 h-3 rounded" style={{ accentColor: '#2563eb' }} />
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-[9.5px] text-slate-700 leading-snug" title={k}>
                        {k}
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

      {/* ── Listing table ──────────────────────────────────────────── */}
      <div ref={listingCardRef}
        className="mx-4 mb-4 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md"
        style={{ opacity: 0 }}>
        <div className="border-b border-gray-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-slate-50 to-blue-50/30">
          <div>
            <div className="flex items-center gap-1.5">
              <BarChart3 size={11} className="text-blue-500" />
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                LISTING OUTSTANDING SUB AKUN FLUKTUASI
              </p>
            </div>
            <p className="text-[9px] text-slate-400 mt-0.5">
              {listingRows.length.toLocaleString('id-ID')} entri
              {listingTotalPages > 1 && ` · Hal ${listPage + 1} / ${listingTotalPages}`}
            </p>
          </div>
          {listingTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <button disabled={listPage === 0}
                onClick={() => setListPage(p => Math.max(0, p - 1))}
                className="text-sm px-2.5 py-0.5 border border-gray-200 rounded-lg bg-white text-slate-500 disabled:opacity-30 hover:bg-blue-50 hover:border-blue-200 transition-all duration-150 active:scale-95">
                {'‹'}
              </button>
              <button disabled={listPage >= listingTotalPages - 1}
                onClick={() => setListPage(p => Math.min(listingTotalPages - 1, p + 1))}
                className="text-sm px-2.5 py-0.5 border border-gray-200 rounded-lg bg-white text-slate-500 disabled:opacity-30 hover:bg-blue-50 hover:border-blue-200 transition-all duration-150 active:scale-95">
                {'›'}
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                {['#','Sub Akun','Klasifikasi','Total Amount','Jml Periode'].map(h => (
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
                const color    = row.subGroup?.color ?? '#64748b';
                return (
                  <tr key={ri}
                    className={`transition-colors duration-100 ${ri % 2 === 0 ? 'bg-white hover:bg-blue-50/30' : 'bg-slate-50 hover:bg-blue-50/50'}`}
                    style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="px-3 py-1.5 text-slate-400">{globalRi + 1}.</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono"
                        style={{ backgroundColor: color + '18', color }}>
                        {row.subGroup?.label ?? '-'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-0.5">
                        {(row.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((k, ki) => (
                          <span key={ki} className="inline-block px-1 py-0.5 rounded text-[8px] font-medium bg-slate-100 text-slate-600 border border-slate-200">{k.trim()}</span>
                        ))}
                      </div>
                    </td>
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
                  <td colSpan={5} className="py-10 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <BarChart3 className="w-8 h-8 text-slate-200" />
                      <span className="text-slate-400 text-sm">Tidak ada data sesuai filter</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {listingPage.length > 0 && (
              <tfoot>
                <tr className="bg-gradient-to-r from-slate-50 to-blue-50/30 border-t border-gray-200">
                  <td colSpan={3} className="px-3 py-1.5 font-bold text-slate-600 text-xs">TOTAL (filtered)</td>
                  <td className="px-3 py-1.5 text-right font-mono font-extrabold text-sm"
                    style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                    {fmtFull(totalFiltered)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-400 text-xs">{listingRows.reduce((s, r) => s + r.periodes, 0)} records</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </div>
  );
}

