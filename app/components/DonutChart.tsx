'use client';

import { memo, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface DonutChartProps {
  data: {
    label: string;
    value: number;
    color: string;
  }[];
  title: string;
  centerText?: string;
  centerSubtext?: string;
}

function DonutChart({ data, title, centerText, centerSubtext }: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  const cardRef    = useRef<HTMLDivElement>(null);
  const svgRef     = useRef<SVGSVGElement>(null);
  const legendRef  = useRef<HTMLDivElement>(null);
  const centerRef  = useRef<HTMLDivElement>(null);
  const pathRefs   = useRef<(SVGPathElement | null)[]>([]);

  /* ── Build arc data (pure calculation, no JSX side-effects) ── */
  let currentAngle = 0;
  const radius = 40, cx = 50, cy = 50;
  const arcs = data.map((item) => {
    if (total === 0) return null;
    const pct   = (item.value / total) * 360;
    const start = currentAngle;
    currentAngle += pct;
    const s = (start - 90) * (Math.PI / 180);
    const e = (currentAngle - 90) * (Math.PI / 180);
    return {
      d: `M ${cx + radius * Math.cos(s)} ${cy + radius * Math.sin(s)} A ${radius} ${radius} 0 ${pct > 180 ? 1 : 0} 1 ${cx + radius * Math.cos(e)} ${cy + radius * Math.sin(e)}`,
      color: item.color,
    };
  });

  /* ── GSAP: draw arcs via strokeDashoffset ────────────────── */
  useEffect(() => {
    pathRefs.current.forEach((path, i) => {
      if (!path) return;
      const len = path.getTotalLength();
      gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
      gsap.to(path,  { strokeDashoffset: 0, duration: 0.9, delay: 0.12 + i * 0.18, ease: 'power3.out' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* ── anime.js: stagger legend items ──────────────────────── */
  useEffect(() => {
    if (!legendRef.current) return;
    const items = legendRef.current.querySelectorAll('.legend-item');
    if (!items.length) return;
    animate(items, {
      opacity: [0, 1], translateX: [20, 0],
      duration: 400, delay: stagger(80, { start: 280 }), ease: 'outExpo',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* ── GSAP: center text count-up ──────────────────────────── */
  useEffect(() => {
    if (!centerRef.current || !centerText) return;
    const num = parseFloat(centerText.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return;
    const proxy = { val: 0 };
    gsap.to(proxy, {
      val: num, duration: 1, delay: 0.4, ease: 'power2.out',
      onUpdate: () => { if (centerRef.current) centerRef.current.textContent = Math.round(proxy.val).toLocaleString('id-ID'); },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerText]);

  /* ── GSAP: card hover lift ────────────────────────────────── */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const enter = () => gsap.to(el, { y: -5, scale: 1.01, duration: 0.25, ease: 'power2.out' });
    const leave = () => gsap.to(el, { y:  0, scale: 1,    duration: 0.25, ease: 'power2.out' });
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => { el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave); };
  }, []);

  return (
    <Card ref={cardRef} className="overflow-hidden transition-shadow cursor-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Donut SVG */}
          <div className="relative flex-shrink-0">
            <svg ref={svgRef} viewBox="0 0 100 100" className="w-44 h-44 -rotate-90">
              {/* background ring */}
              <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
              {arcs.map((arc, i) =>
                arc ? (
                  <path
                    key={i}
                    ref={el => { pathRefs.current[i] = el; }}
                    d={arc.d}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                ) : null
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {centerText && (
                <div ref={centerRef} className="text-2xl font-bold text-foreground">{centerText}</div>
              )}
              {centerSubtext && (
                <div className="text-xs text-muted-foreground mt-0.5">{centerSubtext}</div>
              )}
            </div>
          </div>

          {/* Legend */}
          <div ref={legendRef} className="flex-1 space-y-2 w-full">
            {data.map((item, index) => (
              <div
                key={index}
                className="legend-item flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors opacity-0"
                onMouseEnter={e => gsap.to(e.currentTarget, { x: 4,  duration: 0.18, ease: 'power1.out' })}
                onMouseLeave={e => gsap.to(e.currentTarget, { x: 0,  duration: 0.18, ease: 'power1.out' })}
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-foreground">{item.label}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{item.value.toLocaleString('id-ID')}</div>
                  <div className="text-xs text-muted-foreground">
                    {total > 0 ? ((item.value / total) * 100).toFixed(1) : '0.0'}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(DonutChart);
