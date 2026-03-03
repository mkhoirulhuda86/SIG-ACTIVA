'use client';

import { memo, useEffect, useRef } from 'react';
import { Clock, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { cn } from '@/lib/utils';

interface StatusCardProps {
  title: string;
  items: {
    label: string;
    count: number;
    status: 'success' | 'warning' | 'error' | 'pending';
  }[];
}

const STATUS_CFG = {
  success: { bg: 'bg-green-50  border-green-200',  icon: (s: number) => <CheckCircle size={s} className="text-green-600"   /> },
  warning: { bg: 'bg-yellow-50 border-yellow-200', icon: (s: number) => <AlertCircle size={s} className="text-yellow-600"  /> },
  error:   { bg: 'bg-red-50    border-red-200',    icon: (s: number) => <XCircle     size={s} className="text-red-600"     /> },
  pending: { bg: 'bg-blue-50   border-blue-200',   icon: (s: number) => <Clock       size={s} className="text-blue-600"    /> },
} as const;

function StatusCard({ title, items }: StatusCardProps) {
  const cardRef   = useRef<HTMLDivElement>(null);
  const gridRef   = useRef<HTMLDivElement>(null);
  const countRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /* ── anime.js: stagger tile entrance ─────────────────────── */
  useEffect(() => {
    if (!gridRef.current) return;
    const tiles = gridRef.current.querySelectorAll('.status-tile');
    animate(tiles, { opacity: [0, 1], scale: [0.88, 1], duration: 420, delay: stagger(90), ease: 'outBack' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /* ── GSAP: count-up numbers ───────────────────────────────── */
  useEffect(() => {
    countRefs.current.forEach((el, i) => {
      if (!el) return;
      const target = items[i]?.count ?? 0;
      const proxy  = { val: 0 };
      gsap.to(proxy, {
        val: target, duration: 0.8, delay: 0.15 + i * 0.09, ease: 'power2.out',
        onUpdate: () => { if (el) el.textContent = Math.round(proxy.val).toString(); },
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /* ── GSAP: card hover lift ────────────────────────────────── */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const enter = () => gsap.to(el, { y: -4, duration: 0.25, ease: 'power2.out' });
    const leave = () => gsap.to(el, { y:  0, duration: 0.25, ease: 'power2.out' });
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => { el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave); };
  }, []);

  return (
    <Card ref={cardRef} className="transition-shadow cursor-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((item, index) => {
            const cfg = STATUS_CFG[item.status] ?? { bg: 'bg-muted border-border', icon: () => null };
            return (
              <div
                key={index}
                className={cn('status-tile p-4 rounded-lg border opacity-0 transition-shadow hover:shadow-md', cfg.bg)}
                onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.04, duration: 0.18, ease: 'power1.out' })}
                onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1,    duration: 0.18, ease: 'power1.out' })}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {cfg.icon(18)}
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                  </div>
                  <span ref={el => { countRefs.current[index] = el; }} className="text-xl font-bold text-foreground">0</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(StatusCard);
