'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Mail, Eye, EyeOff, CheckCircle, XCircle, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger, random } from 'animejs';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [email,          setEmail]          = useState('');
  const [password,       setPassword]       = useState('');
  const [showPassword,   setShowPassword]   = useState(false);
  const [error,          setError]          = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading,      setIsLoading]      = useState(false);
  const [accountStatus,  setAccountStatus]  = useState<{
    emailVerified: boolean;
    isApproved: boolean;
  } | null>(null);

  /* ── Refs ────────────────────────────────────────────────── */
  const bgRef    = useRef<HTMLDivElement>(null);
  const cardRef  = useRef<HTMLDivElement>(null);
  const logoRef  = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef  = useRef<HTMLFormElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

  /* ── Entrance animations ─────────────────────────────────── */
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from(bgRef.current, { opacity: 0, duration: 0.5 });
      tl.fromTo(
        logoRef.current,
        { scale: 0, rotate: -20, opacity: 0 },
        { scale: 1, rotate: 0, opacity: 1, duration: 0.65, ease: 'back.out(2)' },
        '-=0.2'
      );
      tl.fromTo(
        cardRef.current,
        { y: 48, opacity: 0, scale: 0.95 },
        { y: 0, opacity: 1, scale: 1, duration: 0.6 },
        '-=0.35'
      );
    });

    // Typewriter on title
    const titleEl = titleRef.current;
    if (titleEl) {
      const text = 'Masuk';
      titleEl.innerHTML = text
        .split('')
        .map(l => `<span style="display:inline-block;opacity:0">${l}</span>`)
        .join('');
      animate('#login-title span', {
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 400,
        delay: stagger(60, { start: 550 }),
        ease: 'outExpo',
      });
    }

    // Animated particles
    const container = bgRef.current;
    if (container) {
      for (let i = 0; i < 14; i++) {
        const el = document.createElement('div');
        const size = Math.random() * 10 + 5;
        el.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;
          width:${size}px;height:${size}px;
          background:${Math.random() > 0.5 ? 'hsl(0 84% 80% / 0.25)' : 'hsl(221 83% 75% / 0.2)'};
          left:${Math.random() * 100}%;top:${Math.random() * 100}%;`;
        container.appendChild(el);
        animate(el, {
          translateX: () => random(-80, 80),
          translateY: () => random(-80, 80),
          opacity: [{ to: 0 }, { to: 0.7 }, { to: 0 }],
          scale: [{ to: 0 }, { to: 1 }, { to: 0 }],
          duration: () => random(4000, 8000),
          delay: () => random(0, 3000),
          loop: true,
          ease: 'inOutSine',
        });
      }
    }

    // Form fields stagger
    setTimeout(() => {
      if (!formRef.current) return;
      animate(formRef.current.querySelectorAll('.form-field'), {
        opacity: [0, 1],
        translateY: [16, 0],
        duration: 450,
        delay: stagger(80, { start: 400 }),
        ease: 'outExpo',
      });
    }, 100);

    return () => ctx.revert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Shake on error ─────────────────────────────────────── */
  const shakeCard = () => {
    if (!cardRef.current) return;
    animate(cardRef.current, {
      translateX: [0, -8, 8, -6, 6, 0],
      duration: 400,
      ease: 'inOutSine',
    });
  };

  /* ── URL param messages ─────────────────────────────────── */
  useEffect(() => {
    if (searchParams.get('registered') === 'true') {
      if (searchParams.get('needVerification') === 'true') {
        setSuccessMessage('Registrasi berhasil! Silakan cek email Anda untuk verifikasi akun.');
      } else if (searchParams.get('verified') === 'true') {
        setSuccessMessage('Email berhasil diverifikasi! Menunggu persetujuan Admin System.');
      } else {
        setSuccessMessage('Registrasi berhasil! Silakan login dengan akun Anda.');
      }
    }
  }, [searchParams]);

  /* ── Login handler ─────────────────────────────────────── */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccessMessage(''); setAccountStatus(null);
    setIsLoading(true);
    if (btnRef.current) gsap.to(btnRef.current, { scale: 0.97, duration: 0.15 });

    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        gsap.to(cardRef.current, {
          scale: 1.02, opacity: 0, y: -20, duration: 0.4, ease: 'power3.in',
          onComplete: () => {
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('username', data.user.username);
            localStorage.setItem('userId', data.user.id);
            localStorage.setItem('userName', data.user.name);
            localStorage.setItem('userRole', data.user.role);
            router.push('/');
          },
        });
      } else {
        if (res.status === 403) {
          try {
            const check = await fetch('/api/users/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            });
            if (check.ok) {
              const cd = await check.json();
              setAccountStatus({ emailVerified: cd.user.emailVerified, isApproved: cd.user.isApproved });
            }
          } catch { /* silent */ }
        }
        setError(data.error || 'Email atau password salah');
        shakeCard();
        setIsLoading(false);
        if (btnRef.current) gsap.to(btnRef.current, { scale: 1, duration: 0.15 });
      }
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
      shakeCard();
      setIsLoading(false);
      if (btnRef.current) gsap.to(btnRef.current, { scale: 1, duration: 0.15 });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 overflow-hidden">
      {/* Background */}
      <div ref={bgRef} className="fixed inset-0 -z-10 gradient-mesh overflow-hidden" />
      {/* Rings */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-primary/5 animate-spin-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-primary/8 animate-spin-slow [animation-direction:reverse] [animation-duration:12s]" />
      </div>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div ref={logoRef} className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 mb-4 drop-shadow-xl">
            <img src="/logo aplikasi.png" alt="SIG ACTIVA" className="w-24 h-24 object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">SIG ACTIVA</h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-[220px] mx-auto leading-snug">
            Sistem Informasi Akuntansi<br />PT Semen Indonesia Grup
          </p>
        </div>

        {/* Card */}
        <Card ref={cardRef as any} className="shadow-2xl border-0 bg-white/80 backdrop-blur-xl">
          <CardContent className="p-6 sm:p-8">
            <h2 id="login-title" ref={titleRef} className="text-xl font-bold text-foreground mb-5">Masuk</h2>

            <form ref={formRef} onSubmit={handleLogin} className="space-y-4">
              {/* Email */}
              <div className="form-field space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="pl-9 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="nama@email.com"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="form-field space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pl-9 pr-10 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Success */}
              {successMessage && (
                <div className={cn(
                  'form-field rounded-lg px-3 py-2.5 text-xs border flex gap-2 items-start',
                  successMessage.includes('persetujuan') ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-green-50 border-green-200 text-green-700'
                )}>
                  <CheckCircle size={13} className="shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="form-field space-y-2">
                  <div className="rounded-lg px-3 py-2.5 text-xs border bg-destructive/5 border-destructive/20 text-destructive flex gap-2 items-start">
                    <XCircle size={13} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                  {accountStatus && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-2">
                      <p className="font-semibold text-foreground">Status Akun:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {accountStatus.emailVerified
                          ? <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle size={9} /> Email Terverifikasi</Badge>
                          : <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle size={9} /> Email Belum Verifikasi</Badge>
                        }
                        {accountStatus.isApproved
                          ? <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle size={9} /> Sudah Disetujui</Badge>
                          : <Badge variant="warning" className="gap-1 text-[10px]"><Clock size={9} /> Menunggu Persetujuan</Badge>
                        }
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submit */}
              <button
                ref={btnRef}
                type="submit"
                disabled={isLoading}
                className={cn(
                  'form-field w-full h-11 flex items-center justify-center gap-2 rounded-lg font-semibold text-sm text-white transition-colors will-change-transform',
                  'bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary/25'
                )}
              >
                {isLoading ? (
                  <><Loader2 size={15} className="animate-spin" /> Memproses...</>
                ) : (
                  <>Masuk <ArrowRight size={15} /></>
                )}
              </button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-5">
              Belum punya akun?{' '}
              <button
                type="button"
                onClick={() => router.push('/register')}
                className="text-primary hover:underline font-semibold"
              >
                Daftar di sini
              </button>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground mt-5">
          © 2026 SIG ACTIVA — PT Semen Indonesia Grup
        </p>
      </div>
    </div>
  );
}
