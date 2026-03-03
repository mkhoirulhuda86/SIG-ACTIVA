'use client';

import { memo, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { animate } from 'animejs';
import { Card, CardContent } from './ui/card';
import { cn } from '@/lib/utils';

interface RekonsiliasiCardProps {
  title: string;
  description: string;
  status: 'normal' | 'warning' | 'error';
  percentage: number;
}

const REKON_CFG = {
  normal:  { text: 'text-green-600',  bar: 'bg-green-500',  label: 'Normal'  },
  warning: { text: 'text-yellow-600', bar: 'bg-yellow-500', label: 'Warning' },
  error:   { text: 'text-red-600',    bar: 'bg-red-500',    label: 'Error'   },
} as const;

function RekonsiliasiCard({ title, description, status, percentage }: RekonsiliasiCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef  = useRef<HTMLDivElement>(null);
  const pctRef  = useRef<HTMLSpanElement>(null);
  const cfg     = REKON_CFG[status] ?? { text: 'text-muted-foreground', bar: 'bg-muted', label: status };

  /* ── GSAP: animate progress bar width ───────────────────── */
  useEffect(() => {
    if (!barRef.current) return;
    gsap.fromTo(barRef.current,
      { width: '0%' },
      { width: `${Math.min(percentage, 100)}%`, duration: 1.1, ease: 'power3.out', delay: 0.2 }
    );
  }, [percentage]);

  /* ── anime.js: count-up percentage ──────────────────────── */
  useEffect(() => {
    const el = pctRef.current;
    if (!el) return;
    const proxy = { val: 0 };
    animate(proxy, {
      val: percentage, duration: 1100, delay: 200, ease: 'outExpo',
      onUpdate: () => { if (el) el.textContent = `${Math.round(proxy.val)}%`; },
    });
  }, [percentage]);

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
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 pr-3">
            <h4 className="text-base font-semibold text-foreground mb-1">{title}</h4>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <span ref={pctRef} className={cn('text-2xl font-bold shrink-0', cfg.text)}>0%</span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden relative">
          <div ref={barRef} className={cn('h-2.5 rounded-full', cfg.bar)} style={{ width: '0%' }} />
          {percentage > 100 && (
            <div className="absolute right-0 top-0 h-2.5 w-1 bg-blue-500 animate-pulse" />
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status:</span>
          <span className={cn('font-medium capitalize', cfg.text)}>
            {percentage > 100 ? 'Over Target' : cfg.label}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(RekonsiliasiCard);
