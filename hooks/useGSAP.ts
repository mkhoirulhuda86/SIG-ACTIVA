'use client';

import { useEffect, useRef, RefObject } from 'react';
import { gsap } from 'gsap';

// ─── GSAP: reveal elements when they mount ─────────────────────────
export function useGSAPReveal(
  deps: unknown[] = [],
  options?: { delay?: number; stagger?: number; from?: 'bottom' | 'left' | 'right' | 'scale' }
) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = containerRef.current.querySelectorAll('.gsap-reveal, .gsap-reveal-left, .gsap-reveal-right, .gsap-scale');
    if (elements.length === 0) {
      // Animate the container itself
      const from = options?.from ?? 'bottom';
      const fromVars: gsap.TweenVars =
        from === 'left' ? { x: -32 } :
        from === 'right' ? { x: 32 } :
        from === 'scale' ? { scale: 0.9 } :
        { y: 24 };

      gsap.from(containerRef.current, {
        ...fromVars,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        delay: options?.delay ?? 0,
      });
    } else {
      gsap.fromTo(
        elements,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.65,
          ease: 'power3.out',
          stagger: options?.stagger ?? 0.08,
          delay: options?.delay ?? 0,
        }
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return containerRef;
}

// ─── GSAP: staggered list animation ────────────────────────────────
export function useGSAPStagger(
  refs: RefObject<HTMLElement | null>[],
  deps: unknown[] = [],
  options?: { stagger?: number; delay?: number; from?: 'bottom' | 'left' }
) {
  useEffect(() => {
    const els = refs.map(r => r.current).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;

    const from = options?.from ?? 'bottom';
    gsap.fromTo(
      els,
      {
        opacity: 0,
        x: from === 'left' ? -24 : 0,
        y: from === 'bottom' ? 24 : 0,
      },
      {
        opacity: 1,
        x: 0,
        y: 0,
        duration: 0.55,
        ease: 'power3.out',
        stagger: options?.stagger ?? 0.07,
        delay: options?.delay ?? 0,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ─── GSAP: tween a number (counter animation) ──────────────────────
export function useGSAPCounter(
  target: number,
  onUpdate: (value: number) => void,
  deps: unknown[] = [],
  options?: { duration?: number; delay?: number }
) {
  useEffect(() => {
    const proxy = { value: 0 };
    const tween = gsap.to(proxy, {
      value: target,
      duration: options?.duration ?? 1.2,
      delay: options?.delay ?? 0,
      ease: 'power2.out',
      onUpdate: () => onUpdate(proxy.value),
    });

    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
}

// ─── GSAP: scale-in on hover ────────────────────────────────────────
export function useGSAPHover(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onEnter = () => gsap.to(el, { scale: 1.03, duration: 0.25, ease: 'power2.out' });
    const onLeave = () => gsap.to(el, { scale: 1, duration: 0.25, ease: 'power2.out' });

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [ref]);
}

// ─── GSAP: page transition loader ──────────────────────────────────
export function useGSAPPageEnter(deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    gsap.from(ref.current, {
      opacity: 0,
      y: 16,
      duration: 0.5,
      ease: 'power3.out',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
