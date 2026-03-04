'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { RotateCcw, TrendingUp, TrendingDown, Minus, Activity, BarChart2, PieChart, Filter, List } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Separator } from '../components/ui/separator';

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
    <div className="flex min-h-screen bg-[#f0f4fa]">
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
        <div ref={skeletonRef} className="flex-1 overflow-y-auto p-3 space-y-3">
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
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#ea580c','#0891b2','#15803d','#9333ea','#ca8a04',
  '#4f46e5','#e11d48',
];

// ─── Semi-circular gauge ──────────────────────────────────────────────────────
function SemiGauge({
  value, max, label, amount, color, animDelay = 0,
}: { value: number; max: number; label: string; amount: number; color: string; animDelay?: number }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const R = 40;
  const cx = 55, cy = 55;

  const startX = cx - R;
  const endX   = cx + R;
  const bgPath = `M ${startX} ${cy} A ${R} ${R} 0 0 1 ${endX} ${cy}`;

  const angle    = Math.PI * pct;
  const fgEndX   = cx + R * Math.cos(Math.PI - angle);
  const fgEndY   = cy - R * Math.sin(Math.PI - angle);
  const largeArc = 0;

  const fgPath = pct < 0.01
    ? ''
    : pct >= 0.999
      ? `M ${startX} ${cy} A ${R} ${R} 0 0 1 ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${endX} ${cy}`
      : `M ${startX} ${cy} A ${R} ${R} 0 ${largeArc} 1 ${fgEndX} ${fgEndY}`;

  // Animated counter
  const [displayAmt, setDisplayAmt] = useState(0);
  const fgRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    // Count-up
    const proxy = { v: 0 };
    animate(proxy, {
      v: Math.abs(amount),
      duration: 1200,
      delay: animDelay,
      ease: 'easeOutExpo',
      onUpdate: () => setDisplayAmt(proxy.v),
    });
    // Stroke-dash animation
    if (fgRef.current && fgPath) {
      const len = fgRef.current.getTotalLength?.() ?? 130;
      gsap.fromTo(fgRef.current,
        { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: 0, duration: 1.2, delay: animDelay / 1000, ease: 'power3.out' }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, pct, animDelay]);

  return (
    <div className="flex flex-col items-center group">
      <svg viewBox="0 0 110 65" style={{ width: 120, height: 72, overflow: 'visible' }}
        className="transition-transform duration-300 group-hover:scale-110">
        <path d={bgPath} fill="none" stroke="#cbd5e1" strokeWidth={11} strokeLinecap="round" />
        {fgPath && (
          <path ref={fgRef} d={fgPath} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#1e293b" fontSize={10} fontWeight="800"
          style={{ letterSpacing: -0.5 }}>
          {fmtCompact(displayAmt)}
        </text>
        <text x={cx} y={cy + 4} textAnchor="middle" fill={color} fontSize={7.5} fontWeight="600">
          {(pct * 100).toFixed(0)}%
        </text>
      </svg>
      <p className="text-center text-[9px] leading-tight max-w-[110px] mt-0.5 text-slate-500 line-clamp-2">{label}</p>
    </div>
  );
}

// ─── Inline Donut chart ───────────────────────────────────────────────────────
function InlineDonut({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    const paths = svgRef.current.querySelectorAll('path.donut-slice');
    gsap.fromTo(paths,
      { scale: 0, transformOrigin: '50px 50px', opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.7, stagger: 0.06, ease: 'back.out(1.4)' }
    );
  }, [total]);

  if (total === 0) return (
    <div style={{ width: 150, height: 150 }} className="flex items-center justify-center">
      <span className="text-slate-400 text-xs">No data</span>
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
  const polarToXY = (cx: number, cy: number, radius: number, deg: number) => ({
    x: cx + radius * Math.cos((deg * Math.PI) / 180),
    y: cy + radius * Math.sin((deg * Math.PI) / 180),
  });
  const arcPath = (pcx: number, pcy: number, oR: number, ir: number, sa: number, sw: number) => {
    if (sw >= 359.9) {
      // Full circle: two arcs
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
    <svg ref={svgRef} viewBox="0 0 100 100" style={{ width: 155, height: 155, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="#f1f5f9" />
      {slices.map((s, i) => (
        <path key={i} className="donut-slice" d={arcPath(cx, cy, R, r, s.startAngle, s.sweep)} fill={s.color} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="white" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#1e293b" fontSize={6} fontWeight="800">
        {fmtCompact(total)}
      </text>
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#94a3b8" fontSize={4.5}>
        Total
      </text>
    </svg>
  );
}

// ─── Trend line / area chart ──────────────────────────────────────────────────
function TrendChart({ data }: { data: { label: string; value: number }[] }) {
  const lineRef  = useRef<SVGPolylineElement>(null);
  const areaRef  = useRef<SVGPolygonElement>(null);
  const dotsRef  = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!lineRef.current || data.length < 2) return;
    const len = lineRef.current.getTotalLength?.() ?? 600;
    gsap.fromTo(lineRef.current,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: 1.6, ease: 'power3.inOut' }
    );
    if (areaRef.current) gsap.fromTo(areaRef.current, { opacity: 0 }, { opacity: 1, duration: 1.2, delay: 0.4 });
    if (dotsRef.current) {
      const dots = dotsRef.current.querySelectorAll('circle');
      gsap.fromTo(dots,
        { scale: 0, transformOrigin: 'center' },
        { scale: 1, duration: 0.4, stagger: 0.03, delay: 0.8, ease: 'back.out(2)' }
      );
    }
  }, [data]);

  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full">
      <span className="text-slate-400 text-xs">Butuh ≥ 2 periode</span>
    </div>
  );
  const W = 480, H = 130, PX = 46, PY = 18;
  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const toX = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const toY = (v: number) => PY + ((maxV - v) / range) * (H - PY * 2 - 12);
  const pts  = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const area = [
    `${toX(0)},${H - 12}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${H - 12}`,
  ].join(' ');
  const step = data.length > 12 ? Math.ceil(data.length / 8) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradLight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y   = PY + t * (H - PY * 2 - 12);
        const val = maxV - t * range;
        return (
          <g key={t}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="#e2e8f0" strokeWidth={0.8} />
            <text x={PX - 4} y={y + 2} textAnchor="end" fill="#64748b" fontSize={6.5}>
              {fmtCompact(val)}
            </text>
          </g>
        );
      })}
      <polygon ref={areaRef} points={area} fill="url(#areaGradLight)" />
      <polyline ref={lineRef} points={pts} fill="none" stroke="#2563eb" strokeWidth={1.8} strokeLinejoin="round" />
      <g ref={dotsRef}>
      {data.map((d, i) => {
        const showDot   = data.length <= 30;
        const showLabel = i % step === 0 || i === data.length - 1;
        return (
          <g key={i}>
            {showDot && <circle cx={toX(i)} cy={toY(d.value)} r={2.5} fill="#2563eb" stroke="white" strokeWidth={1} />}
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

// ─── Horizontal bar item ──────────────────────────────────────────────────────
function HBarItem({
  label, value, max, color, rank, animDelay = 0,
}: { label: string; value: number; max: number; color: string; rank: number; animDelay?: number }) {
  const pct   = max > 0 ? (Math.abs(value) / max) * 100 : 0;
  const isNeg = value < 0;
  const barRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (barRef.current) {
      gsap.fromTo(barRef.current,
        { width: '0%' },
        { width: `${pct}%`, duration: 1.1, delay: animDelay / 1000 + 0.1, ease: 'power3.out' }
      );
    }
    if (rowRef.current) {
      gsap.fromTo(rowRef.current,
        { opacity: 0, x: -16 },
        { opacity: 1, x: 0, duration: 0.55, delay: animDelay / 1000, ease: 'power3.out' }
      );
      const el = rowRef.current;
      const onEnter = () => gsap.to(el, { x: 3, duration: 0.2, ease: 'power2.out' });
      const onLeave = () => gsap.to(el, { x: 0, duration: 0.2, ease: 'power2.out' });
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      return () => { el.removeEventListener('mouseenter', onEnter); el.removeEventListener('mouseleave', onLeave); };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, animDelay]);

  return (
    <div ref={rowRef} className="flex items-center gap-2">
      <span className="text-[9px] w-3 text-right flex-shrink-0 text-slate-400">{rank}.</span>
      <span className="text-[10px] flex-shrink-0 truncate text-slate-500 font-medium" style={{ width: 120 }} title={label}>
        {label.length > 16 ? label.slice(0, 16) + '…' : label}
      </span>
      <div className="flex-1 relative h-5 rounded overflow-hidden bg-slate-100">
        <div ref={barRef} className="h-full rounded"
          style={{ width: '0%', backgroundColor: color, opacity: isNeg ? 0.6 : 0.85 }} />
        <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-slate-700">
          {fmtCompact(value)}
        </span>
      </div>
    </div>
  );
}

// ─── Klasifikasi bar row (animated) ──────────────────────────────────────────
function KlasiBar({ label, pct, value, color, animDelay = 0 }: { label: string; pct: number; value: number; color: string; animDelay?: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (barRef.current) {
      gsap.fromTo(barRef.current,
        { width: '0%' },
        { width: `${pct}%`, duration: 1.0, delay: animDelay / 1000 + 0.15, ease: 'power3.out' }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, animDelay]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-slate-400 flex-shrink-0" style={{ width: 60, textAlign: 'right' }}>
        {fmtCompact(Math.abs(value))}
      </span>
      <div className="flex-1 relative h-5 rounded-md overflow-hidden bg-slate-100">
        <div ref={barRef} className="h-full rounded-md" style={{ width: '0%', backgroundColor: color, opacity: 0.85 }} />
        <span className="absolute inset-0 flex items-center px-2 text-[9px] text-slate-700 font-medium truncate">{label}</span>
      </div>
    </div>
  );
}

// ─── Animated Aging Chart ─────────────────────────────────────────────────────
function AnimatedAgingChart({ buckets, maxAbsB, bColors, VW, slot, bw, BAR_MAX, BASE_Y }:
  { buckets: {label:string;value:number}[]; maxAbsB:number; bColors:string[]; VW:number; slot:number; bw:number; BAR_MAX:number; BASE_Y:number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const rects  = svgRef.current.querySelectorAll('rect.aging-bar');
    const labels = svgRef.current.querySelectorAll('text.aging-val');
    rects.forEach((rect, i) => {
      const finalH = parseFloat(rect.getAttribute('data-final-h') ?? '0');
      const finalY = parseFloat(rect.getAttribute('data-final-y') ?? '0');
      gsap.fromTo(rect,
        { attr: { height: 0, y: BASE_Y } },
        { attr: { height: finalH, y: finalY }, duration: 0.9, delay: i * 0.12, ease: 'power3.out' }
      );
    });
    gsap.fromTo(labels,
      { opacity: 0, attr: { y: BASE_Y - 20 } },
      { opacity: 1, duration: 0.5, stagger: 0.1, delay: 0.3, ease: 'power2.out' }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets]);

  return (
    <div style={{ position: 'relative', height: 265, overflow: 'visible' }}>
      <svg ref={svgRef} viewBox={`0 0 ${VW} 265`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {buckets.map((bk, i) => {
          const cx    = slot * i + slot / 2;
          const x     = cx - bw / 2;
          const barH  = bk.value !== 0 ? (Math.abs(bk.value) / maxAbsB) * BAR_MAX : 2;
          const isNeg = bk.value < 0;
          const y     = BASE_Y - barH;
          return (
            <g key={i}>
              <rect className="aging-bar" x={x} y={BASE_Y} width={bw} height={0} rx={4}
                data-final-h={barH} data-final-y={y}
                fill={bColors[i % bColors.length]} opacity={isNeg ? 0.6 : 0.85} />
              <text className="aging-val" x={cx} y={y - 6} textAnchor="middle" fill="#1e293b" fontSize={11} fontWeight="700" opacity={0}>
                {fmtCompact(bk.value)}
              </text>
              <text x={cx} y={222} textAnchor="middle" fill="#64748b" fontSize={9.5}>
                {bk.label.split('.')[0].trim()}
              </text>
              <text x={cx} y={237} textAnchor="middle" fill="#94a3b8" fontSize={8.5}>
                {bk.label.split(/[.\s]/).slice(1).join(' ').substring(0, 18)}
              </text>
            </g>
          );
        })}
        <line x1={0} y1={BASE_Y} x2={VW} y2={BASE_Y} stroke="#e2e8f0" strokeWidth={0.8} />
      </svg>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OverviewFluktuasiPage() {
  const [records, setRecords]                   = useState<AkunPeriodeRecord[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false);

  const [selectedYear,      setSelectedYear]      = useState<string>('all');
  const [filterKlasifikasi, setFilterKlasifikasi] = useState<Set<string>>(new Set());
  const [filterAccount,     setFilterAccount]     = useState<Set<string>>(new Set());
  const [listPage,          setListPage]          = useState(0);
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
    const s = new Set<string>();
    records.forEach(r => {
      const raw = r.klasifikasi || '(Tanpa Klasifikasi)';
      raw.split(';').map((p: string) => p.trim()).filter(Boolean).forEach((k: string) => s.add(k));
    });
    return [...s].sort();
  }, [records]);

  const allAccounts = useMemo(() => {
    const s = new Set(records.map(r => r.accountCode));
    return [...s].sort();
  }, [records]);

  const filtered = useMemo(() => records.filter(r => {
    if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return false;
    if (filterKlasifikasi.size > 0) {
      const parts = (r.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((p: string) => p.trim()).filter(Boolean);
      if (!parts.some((k: string) => filterKlasifikasi.has(k))) return false;
    }
    if (filterAccount.size > 0 && !filterAccount.has(r.accountCode)) return false;
    return true;
  }), [records, selectedYear, filterKlasifikasi, filterAccount]);

  const byYear = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach(r => {
      const yr = r.periode.split('.')[0];
      m.set(yr, (m.get(yr) ?? 0) + r.amount);
    });
    return years.map(yr => ({ yr, total: m.get(yr) ?? 0 }));
  }, [records, years]);

  const byKlasifikasi = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => {
      const raw = r.klasifikasi || '(Tanpa Klasifikasi)';
      const parts = raw.split(';').map((p: string) => p.trim()).filter(Boolean);
      const share = r.amount / parts.length; // always divide by full count
      const activeParts = filterKlasifikasi.size > 0
        ? parts.filter((k: string) => filterKlasifikasi.has(k))
        : parts;
      activeParts.forEach((k: string) => {
        m.set(k, (m.get(k) ?? 0) + share);
      });
    });
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
  }, [filtered, filterKlasifikasi]);

  const byPeriode = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.periode, (m.get(r.periode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, value]) => ({ label: periodeToLabel(p), value }));
  }, [filtered]);

  const top10Accounts = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach(r => m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + r.amount));
    return [...m.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([acc, val]) => ({ label: acc, value: val }));
  }, [filtered]);

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

  const totalFiltered = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);
  const maxAbsKlasi   = useMemo(() => byKlasifikasi.length > 0 ? Math.abs(byKlasifikasi[0].value) : 1, [byKlasifikasi]);
  const maxAbsAccount = useMemo(() => top10Accounts.length > 0 ? Math.abs(top10Accounts[0].value) : 1, [top10Accounts]);
  const donutTotal    = useMemo(() => byKlasifikasi.reduce((s, d) => s + Math.abs(d.value), 0), [byKlasifikasi]);

  const { lastTwo, momGap, momPct } = useMemo(() => {
    const lastTwo = byPeriode.slice(-2);
    const momGap  = lastTwo.length === 2 ? lastTwo[1].value - lastTwo[0].value : null;
    const momPct  = lastTwo.length === 2 && lastTwo[0].value !== 0
      ? (momGap! / Math.abs(lastTwo[0].value)) * 100
      : null;
    return { lastTwo, momGap, momPct };
  }, [byPeriode]);

  // Precomputed account amounts for filter panel (avoids O(n×m) inline loop)
  const accountAmountsByYear = useMemo(() => {
    const m = new Map<string, number>();
    records.forEach(r => {
      if (selectedYear !== 'all' && !r.periode.startsWith(selectedYear + '.')) return;
      m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + r.amount);
    });
    return m;
  }, [records, selectedYear]);

  // Aging buckets precomputed (also fixes O(n) pSlice.includes → O(1) Set lookup)
  const agingData = useMemo(() => {
    const sortedPeriodes = [...new Map(filtered.map(r => [r.periode, 0])).keys()].sort();
    const n = sortedPeriodes.length;
    const buckets: { label: string; value: number }[] = [];
    if (n > 0) {
      const bSize = Math.ceil(n / 5);
      for (let b = 0; b < 5; b++) {
        const start  = b * bSize;
        const end    = Math.min(start + bSize, n);
        const pSlice = sortedPeriodes.slice(start, end);
        const pSet   = new Set(pSlice);
        const sum    = filtered.filter(r => pSet.has(r.periode)).reduce((s, r) => s + r.amount, 0);
        const lbl    = pSlice.length > 0
          ? `${b + 1}. ${periodeToLabel(pSlice[0])}${pSlice.length > 1 ? '–' + periodeToLabel(pSlice[pSlice.length - 1]) : ''}`
          : `Bucket ${b + 1}`;
        buckets.push({ label: lbl, value: sum });
      }
    }
    const maxAbsB = Math.max(...buckets.map(bk => Math.abs(bk.value)), 1);
    return { buckets, maxAbsB };
  }, [filtered]);

  const toggleKlasifikasi = useCallback((k: string) => setFilterKlasifikasi(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  }), []);
  const toggleAccount = useCallback((a: string) => setFilterAccount(prev => {
    const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n;
  }), []);
  const resetFilters = useCallback(() => {
    setSelectedYear('all'); setFilterKlasifikasi(new Set()); setFilterAccount(new Set()); setListPage(0);
  }, []);

  // ── Refs for GSAP page animations ─────────────────────────────────────────
  const yearBarRef  = useRef<HTMLDivElement>(null);
  const row1Ref     = useRef<HTMLDivElement>(null);
  const row2Ref     = useRef<HTMLDivElement>(null);
  const tableRef    = useRef<HTMLDivElement>(null);

  // Animated total counter display
  const [displayTotal, setDisplayTotal] = useState(0);
  useEffect(() => {
    const proxy = { v: 0 };
    animate(proxy, {
      v: Math.abs(totalFiltered),
      duration: 1400,
      ease: 'easeOutExpo',
      onUpdate: () => setDisplayTotal(proxy.v),
    });
  }, [totalFiltered]);

  // Page-enter GSAP animations (runs whenever data loads)
  useEffect(() => {
    if (loading || records.length === 0) return;
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    if (yearBarRef.current)
      tl.fromTo(yearBarRef.current, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.45 }, 0);
    if (row1Ref.current) {
      const cards = row1Ref.current.querySelectorAll('.anim-card');
      tl.fromTo(cards, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.1 }, 0.1);
    }
    if (row2Ref.current) {
      const cards = row2Ref.current.querySelectorAll('.anim-card');
      tl.fromTo(cards, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.1 }, 0.3);
    }
    if (tableRef.current)
      tl.fromTo(tableRef.current, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.55 }, 0.45);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, loading]);

  // Table rows stagger on page/filter change
  useEffect(() => {
    if (!tableRef.current) return;
    const rows = tableRef.current.querySelectorAll('tbody tr');
    animate(rows, {
      opacity: [0, 1],
      translateX: [-8, 0],
      duration: 300,
      delay: stagger(18, { start: 80 }),
      ease: 'easeOutExpo',
    });
  }, [listPage, listingRows]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton isMobileSidebarOpen={isMobileSidebarOpen} setMobileSidebar={setMobileSidebar} />;

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (records.length === 0) return (
    <div className="flex min-h-screen bg-[#f0f4fa]">
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
    <div className="flex min-h-screen bg-[#f0f4fa]">
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
          subtitle={`${selectedYear === 'all' ? 'Semua Periode' : 'Tahun ' + selectedYear}${filterKlasifikasi.size > 0 || filterAccount.size > 0 ? ' · Terfilter' : ''} · ${filtered.length.toLocaleString('id-ID')} records`}
          onMenuClick={() => setMobileSidebar(true)}
        />

        {/* Trend year buttons bar */}
        <div ref={yearBarRef} className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center gap-2 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 hidden md:flex items-center gap-1 mr-1">
            <Activity size={13} className="text-blue-500" /> TREND TAHUNAN:
          </span>
          {byYear.map(({ yr, total }, i) => {
            const isSelected = selectedYear === yr;
            const isLatest   = i === byYear.length - 1;
            return (
              <button
                key={yr}
                onClick={() => { setSelectedYear(yr === selectedYear ? 'all' : yr); setListPage(0); }}
                className="flex flex-col items-center rounded-lg transition-all duration-200 hover:shadow-md active:scale-95"
                style={{
                  backgroundColor: isSelected ? '#2563eb' : isLatest ? '#eff6ff' : '#f8fafc',
                  color:           isSelected ? 'white'   : isLatest ? '#2563eb' : '#475569',
                  border:          isSelected ? '2px solid #2563eb' : isLatest ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                  borderRadius:    8,
                  minWidth:        80,
                  padding:         '5px 12px',
                  fontWeight:      700,
                  boxShadow:       isSelected ? '0 2px 12px rgba(37,99,235,0.35)' : undefined,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.75 }}>{yr}</span>
                <span style={{ fontSize: 13 }}>{fmtCompact(total)}</span>
              </button>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            className="flex items-center gap-1 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
          >
            <RotateCcw size={11} /> Reset
          </Button>

          {/* Animated total summary pill */}
          <div className="ml-auto hidden lg:flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg px-3 py-1.5">
            <BarChart2 size={14} className="text-blue-500 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">Total Filtered:</span>
            <span className="text-sm font-extrabold font-mono"
              style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
              {fmtCompact(displayTotal)}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* Row 1 */}
          <div ref={row1Ref} className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(240px,280px)_1fr_minmax(200px,220px)]">

            {/* Left column */}
            <div className="flex flex-col gap-3">

              {/* Donut card */}
              <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <PieChart size={12} className="text-blue-500" /> Distribusi Klasifikasi
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-2">
                  <div className="flex items-start gap-2">
                    <InlineDonut data={byKlasifikasi.slice(0, 10).map(d => ({ ...d, value: Math.abs(d.value) }))} total={donutTotal} />
                    <div className="flex flex-col gap-1 flex-1 min-w-0 mt-2">
                      {byKlasifikasi.slice(0, 7).map((d, i) => {
                        const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100).toFixed(1) : '0.0';
                        return (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="flex-shrink-0 rounded-sm" style={{ width: 8, height: 8, backgroundColor: d.color }} />
                            <span className="truncate flex-1 text-[10px] text-slate-500" title={d.label}>
                              {d.label.length > 15 ? d.label.slice(0, 15) + '…' : d.label}
                            </span>
                            <span className="text-[9px] flex-shrink-0 text-slate-400">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Separator className="my-2" />
                  <table className="w-full" style={{ fontSize: 9.5 }}>
                    <tbody>
                      {byKlasifikasi.slice(0, 6).map((d, i) => {
                        const pct = donutTotal > 0 ? (Math.abs(d.value) / donutTotal * 100) : 0;
                        return (
                          <tr key={i} className="hover:bg-slate-50 transition-colors duration-150 rounded">
                            <td className="text-slate-400 py-0.5">{i + 1}.</td>
                            <td className="text-slate-600 py-0.5 px-1" style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</td>
                            <td className="text-slate-800 text-right font-mono py-0.5 font-semibold">{fmtCompact(d.value)}</td>
                            <td className="text-slate-400 text-right pl-1 py-0.5">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-gray-100">
                        <td colSpan={2} className="font-bold text-slate-700 py-1">Total</td>
                        <td className="text-right font-bold text-slate-800 font-mono py-1">{fmtCompact(totalFiltered)}</td>
                        <td className="text-right text-slate-400 pl-1 py-1">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Per-year card */}
              <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <BarChart2 size={12} className="text-indigo-500" /> Total Per Tahun
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-2">
                  <div className="space-y-1.5">
                    {byYear.map(({ yr, total }) => {
                      const isPos      = total >= 0;
                      const isSelected = selectedYear === yr;
                      return (
                        <div key={yr}
                          onClick={() => { setSelectedYear(yr === selectedYear ? 'all' : yr); setListPage(0); }}
                          className="flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-sm"
                          style={{
                            border:          isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                            backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                            transform:       isSelected ? 'scale(1.01)' : 'scale(1)',
                          }}>
                          <span className="text-sm font-medium text-slate-600">Tahun {yr}</span>
                          <span className="text-sm font-bold font-mono" style={{ color: isPos ? '#16a34a' : '#dc2626' }}>
                            {fmtCompact(total)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {momGap !== null && momPct !== null && (
                    <>
                      <Separator className="my-2" />
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">MoM Terkini</p>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span style={{ color: momGap > 0 ? '#16a34a' : momGap < 0 ? '#dc2626' : '#94a3b8' }}>
                          {momGap > 0 ? <TrendingUp size={18} /> : momGap < 0 ? <TrendingDown size={18} /> : <Minus size={18} />}
                        </span>
                        <div>
                          <p className="text-sm font-bold font-mono" style={{ color: momGap > 0 ? '#16a34a' : momGap < 0 ? '#dc2626' : '#94a3b8' }}>
                            {fmtCompact(momGap)}
                          </p>
                          <p className="text-[9px] text-slate-400">{momPct.toFixed(1)}% dari {lastTwo[0]?.label}</p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Center column */}
            <div className="flex flex-col gap-3">

              {/* Gauges card */}
              <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center flex items-center justify-center gap-1.5">
                    <Activity size={12} className="text-purple-500" /> KLASIFIKASI GROUPING FLUKTUASI
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-2">
                  <div className="flex flex-wrap justify-center gap-3">
                    {byKlasifikasi.map((d, i) => (
                      <SemiGauge key={i} value={Math.abs(d.value)} max={maxAbsKlasi} label={d.label} amount={d.value} color={d.color} animDelay={i * 60} />
                    ))}
                  </div>
                  <Separator className="mt-3 mb-2" />
                  <div className="space-y-2">
                    {byKlasifikasi.map((d, i) => {
                      const pct = maxAbsKlasi > 0 ? (Math.abs(d.value) / maxAbsKlasi) * 100 : 0;
                      return (
                        <KlasiBar key={i} label={d.label} pct={pct} value={d.value} color={d.color} animDelay={i * 50} />
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Trend chart card */}
              <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <TrendingUp size={12} className="text-blue-500" /> TREN FLUKTUASI PER PERIODE
                    </span>
                    <Badge variant="secondary" className="text-[9px]">{byPeriode.length} periode</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-2">
                  <div style={{ height: 148 }}>
                    <TrendChart data={byPeriode} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column – Filter */}
            <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Filter size={12} className="text-slate-400" /> FILTER
                  </span>
                  <button onClick={resetFilters} className="text-blue-600 text-xs hover:opacity-80 transition font-medium">Reset</button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-2">
                <div className="mb-3">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Klasifikasi</p>
                  <div className="border border-gray-200 rounded-lg bg-gray-50 max-h-40 overflow-y-auto p-1.5">
                    {allKlasifikasi.map(k => {
                      const color     = byKlasifikasi.find(d => d.label === k)?.color ?? '#94a3b8';
                      const amt       = byKlasifikasi.find(d => d.label === k)?.value ?? 0;
                      const isChecked = filterKlasifikasi.size === 0 || filterKlasifikasi.has(k);
                      return (
                        <label key={k} className="flex items-center gap-1.5 px-1 py-0.5 rounded-md cursor-pointer hover:bg-blue-50 transition-colors duration-150">
                          <input type="checkbox" checked={isChecked} onChange={() => { toggleKlasifikasi(k); setListPage(0); }}
                            className="w-3 h-3 rounded" style={{ accentColor: '#2563eb' }} />
                          <span className="flex-shrink-0 w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                          <span className="flex-1 truncate text-slate-600" style={{ fontSize: 9.5 }} title={k}>
                            {k.length > 18 ? k.slice(0, 18) + '…' : k}
                          </span>
                          <span className="text-slate-400" style={{ fontSize: 8.5, flexShrink: 0 }}>{fmtCompact(amt)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Kode Akun</p>
                  <div className="border border-gray-200 rounded-lg bg-gray-50 max-h-44 overflow-y-auto p-1.5">
                    {allAccounts.map(a => {
                      const amt       = accountAmountsByYear.get(a) ?? 0;
                      const isChecked = filterAccount.size === 0 || filterAccount.has(a);
                      return (
                        <label key={a} className="flex items-center gap-1.5 px-1 py-0.5 rounded-md cursor-pointer hover:bg-blue-50 transition-colors duration-150">
                          <input type="checkbox" checked={isChecked} onChange={() => { toggleAccount(a); setListPage(0); }}
                            className="w-3 h-3 rounded" style={{ accentColor: '#2563eb' }} />
                          <span className="flex-1 font-mono text-slate-600" style={{ fontSize: 9.5 }}>{a}</span>
                          <span className="text-slate-400" style={{ fontSize: 8.5, flexShrink: 0 }}>{fmtCompact(amt)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2 */}
          <div ref={row2Ref} className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_minmax(300px,380px)]">

            {/* Aging chart */}
            <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <BarChart2 size={12} className="text-orange-500" /> AGING FLUKTUASI
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-2">
                {(() => {
                  const { buckets, maxAbsB } = agingData;
                  const bColors  = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed'];
                  const numBuckets = buckets.length || 1;
                  const VW      = 500;
                  const slot    = VW / numBuckets;
                  const bw      = slot * 0.60;
                  const BAR_MAX = 175;
                  const BASE_Y  = 205;
                  return (
                    <AnimatedAgingChart buckets={buckets} maxAbsB={maxAbsB} bColors={bColors}
                      VW={VW} slot={slot} bw={bw} BAR_MAX={BAR_MAX} BASE_Y={BASE_Y} />
                  );
                })()}
              </CardContent>
            </Card>

            {/* Top 10 accounts */}
            <Card className="anim-card shadow-sm hover:shadow-md transition-shadow duration-300 border-0 bg-white">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <List size={12} className="text-blue-500" /> TOP 10 AKUN OUTSTANDING
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-2">
                <div className="space-y-1.5">
                  {top10Accounts.map((a, i) => (
                    <HBarItem key={i} label={a.label} value={a.value} max={maxAbsAccount}
                      color={PALETTE[i % PALETTE.length]} rank={i + 1} animDelay={i * 60} />
                  ))}
                  {top10Accounts.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-4">Tidak ada data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Listing table */}
          <div ref={tableRef}>
            <Card className="shadow-sm border-0 bg-white overflow-hidden">
              <div className="border-b border-gray-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-slate-50 to-white">
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                    <List size={12} className="text-slate-400" /> LISTING OUTSTANDING
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    {listingRows.length.toLocaleString('id-ID')} entri
                    {listingTotalPages > 1 && ` · Hal ${listPage + 1}/${listingTotalPages}`}
                  </p>
                </div>
                {listingTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={listPage === 0}
                      onClick={() => setListPage(p => Math.max(0, p - 1))}
                      className="text-slate-500 disabled:opacity-30 h-7 px-2">
                      ‹
                    </Button>
                    <Button variant="outline" size="sm" disabled={listPage >= listingTotalPages - 1}
                      onClick={() => setListPage(p => Math.min(listingTotalPages - 1, p + 1))}
                      className="text-slate-500 disabled:opacity-30 h-7 px-2">
                      ›
                    </Button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: 10.5, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg,#1e3a5f,#1e40af)' }}>
                      {['#','Kode Akun','Klasifikasi','Total Amount','Jml Periode'].map(h => (
                        <th key={h} style={{
                          padding: '8px 12px',
                          textAlign: h === 'Total Amount' ? 'right' : 'left',
                          color: '#bfdbfe',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          whiteSpace: 'nowrap',
                          fontSize: 9,
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listingPage.map((row, ri) => {
                      const globalRi = listPage * LIST_PAGE_SIZE + ri;
                      const isPos    = row.total >= 0;
                      return (
                        <tr key={ri}
                          className={`transition-colors duration-150 hover:bg-blue-50/60 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}`}
                          style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td className="px-3 py-1.5 text-slate-400">{globalRi + 1}.</td>
                          <td className="px-3 py-1.5 font-mono font-semibold text-blue-600">{row.accountCode}</td>
                          <td className="px-3 py-1.5 max-w-[220px]">
                            <div className="flex flex-wrap gap-0.5">
                              {(row.klasifikasi || '(Tanpa Klasifikasi)').split(';').map((k, ki) => (
                                <Badge key={ki} variant="secondary"
                                  className="text-[8px] font-medium px-1 py-0.5 h-auto rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  {k.trim()}
                                </Badge>
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
                        <td colSpan={5} className="py-8 text-center text-slate-400">Tidak ada data sesuai filter</td>
                      </tr>
                    )}
                  </tbody>
                  {listingPage.length > 0 && (
                    <tfoot>
                      <tr className="bg-gradient-to-r from-slate-100 to-slate-50 border-t-2 border-blue-100">
                        <td colSpan={3} className="px-3 py-2 font-bold text-slate-600 text-xs">TOTAL (filtered)</td>
                        <td className="px-3 py-2 text-right font-mono font-extrabold text-sm"
                          style={{ color: totalFiltered >= 0 ? '#16a34a' : '#dc2626' }}>
                          {fmtFull(totalFiltered)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400 text-xs">{filtered.length} records</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          </div>

        </div>{/* /content */}
      </div>{/* /main */}
    </div>
  );
}
