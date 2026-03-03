'use client';

import { memo, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface ChartData {
  label: string;
  value: number;
  percentage?: number;
  trend?: 'up' | 'down' | 'stable';
}

interface SimpleBarChartProps {
  data: ChartData[];
  title: string;
  maxValue?: number;
  color?: string;
  height?: number;
}

function SimpleBarChart({ data, title, maxValue }: SimpleBarChartProps) {
  const max = maxValue || Math.max(...data.map(d => Math.abs(d.value)), 1);

  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const COLORS = ['#dc2626', '#059669', '#2563eb', '#7c3aed', '#ea580c'];
  const getColor = (i: number, value: number) =>
    value < 0 ? '#f87171' : COLORS[i % COLORS.length];

  /* ── GSAP: animate bar widths from 0 → actual ─────────────── */
  useEffect(() => {
    barRefs.current.forEach((bar, i) => {
      if (!bar || !data[i]) return;
      const target = `${(Math.abs(data[i].value) / max) * 100}%`;
      gsap.fromTo(bar, { width: '0%' }, { width: target, duration: 0.85, delay: 0.1 + i * 0.1, ease: 'power3.out' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, max]);

  /* ── anime.js: stagger row entrance ──────────────────────── */
  useEffect(() => {
    if (!listRef.current) return;
    const rows = listRef.current.querySelectorAll('.bar-row');
    animate(rows, { opacity: [0, 1], translateY: [16, 0], duration: 400, delay: stagger(80), ease: 'outExpo' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  const getTrendIcon = (trend?: 'up' | 'down' | 'stable') => (
    trend === 'up'     ? <TrendingUp  size={14} className="text-green-600" /> :
    trend === 'down'   ? <TrendingDown size={14} className="text-red-600" />   :
    trend === 'stable' ? <Minus        size={14} className="text-muted-foreground" /> : null
  );

  return (
    <Card ref={cardRef} className="overflow-hidden transition-shadow cursor-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent ref={listRef}>
        <div className="space-y-4">
          {data.map((item, index) => (
            <div key={index} className="bar-row space-y-1.5 opacity-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  {item.trend && getTrendIcon(item.trend)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{Math.round(item.value).toLocaleString('id-ID')}</span>
                  {item.percentage !== undefined && (
                    <span className="text-xs text-muted-foreground">({item.percentage}%)</span>
                  )}
                </div>
              </div>
              <div
                className="w-full bg-muted rounded-full h-3 overflow-hidden"
                onMouseEnter={() => { const b = barRefs.current[index]; if (b) gsap.to(b, { filter: 'brightness(1.15)', duration: 0.18 }); }}
                onMouseLeave={() => { const b = barRefs.current[index]; if (b) gsap.to(b, { filter: 'brightness(1)',    duration: 0.18 }); }}
              >
                <div
                  ref={el => { barRefs.current[index] = el; }}
                  className="h-3 rounded-full"
                  style={{ backgroundColor: getColor(index, item.value), width: '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(SimpleBarChart);
