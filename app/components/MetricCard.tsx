'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Card, CardContent } from './ui/card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

const colorMap: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   ring: 'ring-blue-200',   glow: 'shadow-blue-100' },
  green:  { bg: 'bg-green-50',  text: 'text-green-600',  ring: 'ring-green-200',  glow: 'shadow-green-100' },
  red:    { bg: 'bg-red-50',    text: 'text-red-600',    ring: 'ring-red-200',    glow: 'shadow-red-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', ring: 'ring-purple-200', glow: 'shadow-purple-100' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-200', glow: 'shadow-orange-100' },
};

function MetricCard({ title, value, icon, color }: MetricCardProps) {
  const cardRef   = useRef<HTMLDivElement>(null);
  const valueRef  = useRef<HTMLHeadingElement>(null);
  const iconBoxRef = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState('0');

  const colors = colorMap[color] ?? colorMap.blue;

  /* ── GSAP entrance ─────────────────────────────────────────── */
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 28, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }
    );

    if (iconBoxRef.current) {
      gsap.fromTo(
        iconBoxRef.current,
        { scale: 0, rotate: -15 },
        { scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(1.5)', delay: 0.2 }
      );
    }
  }, []);

  /* ── GSAP counter — animates when `value` changes ──────────── */
  useEffect(() => {
    // Extract the leading numeric portion, handling Indonesian comma-decimal
    // e.g. "Rp 340,7 M"  → firstNum = "340,7" → numeric = 340.7
    //      "Rp -451 M"   → firstNum = "-451"  → numeric = -451
    const trimmed = value.replace(/^[^\d\-]*/, '');          // strip leading non-digit/dash
    const firstNum = trimmed.match(/^-?[\d]+([,.][\d]+)?/); // match first number (incl. comma-decimal)
    const numStr   = firstNum ? firstNum[0].replace(',', '.') : '';
    const numeric  = parseFloat(numStr);
    const isNumeric = !isNaN(numeric);
    const prefix = value.match(/^[^\d\-]*/)?.[0] ?? '';
    const suffix = value.replace(/^[^\d\-]*-?[\d,.]+/, '');

    if (!isNumeric) {
      setDisplayed(value);
      return;
    }

    // Determine decimal places from the original formatted value
    const decimalMatch = numStr.match(/\.(\d+)$/);
    const decimals = decimalMatch ? decimalMatch[1].length : 0;

    // Reset
    setDisplayed(prefix + '0' + suffix);

    const proxy = { v: 0 };
    const tween = gsap.to(proxy, {
      v: numeric,
      duration: 1.4,
      delay: 0.35,
      ease: 'power2.out',
      onUpdate: () => {
        // Keep the original suffix (e.g. " M", " JT") — do NOT re-format with B/M/K
        const formatted = proxy.v.toLocaleString('id-ID', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        setDisplayed(prefix + formatted + suffix);
      },
    });

    if (valueRef.current) {
      gsap.fromTo(
        valueRef.current,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.4, delay: 0.3 }
      );
    }

    return () => { tween.kill(); };
  }, [value]);

  /* ── GSAP hover ────────────────────────────────────────────── */
  const onMouseEnter = () => {
    if (!cardRef.current) return;
    gsap.to(cardRef.current, { y: -4, scale: 1.02, duration: 0.25, ease: 'power2.out' });
    if (iconBoxRef.current) {
      gsap.to(iconBoxRef.current, { scale: 1.15, rotate: 8, duration: 0.3, ease: 'back.out(2)' });
    }
  };
  const onMouseLeave = () => {
    if (!cardRef.current) return;
    gsap.to(cardRef.current, { y: 0, scale: 1, duration: 0.25, ease: 'power2.out' });
    if (iconBoxRef.current) {
      gsap.to(iconBoxRef.current, { scale: 1, rotate: 0, duration: 0.25, ease: 'power2.out' });
    }
  };

  return (
    <Card
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'cursor-default h-full border-0 shadow-md will-change-transform',
        `shadow-${color}-100/50`
      )}
    >
      <CardContent className="p-4 sm:p-5 h-full">
        <div className="flex items-center justify-between h-full gap-3">
          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground mb-1.5 truncate font-medium">
              {title}
            </p>
            <h3
              ref={valueRef}
              className="text-base sm:text-lg lg:text-xl font-bold text-foreground leading-tight"
            >
              {displayed}
            </h3>
          </div>

          {/* Icon */}
          <div
            ref={iconBoxRef}
            className={cn(
              'p-2.5 sm:p-3 rounded-xl shrink-0 ring-2 will-change-transform',
              colors.bg, colors.text, colors.ring
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(MetricCard);

