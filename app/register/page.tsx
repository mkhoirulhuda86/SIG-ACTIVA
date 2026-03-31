'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User, Eye, EyeOff, Mail, UserPlus, ArrowRight, Loader2, Info, XCircle } from 'lucide-react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { animate, stagger, random } from 'animejs';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent } from '@/app/components/ui/card';
import TypedText from '@/app/components/TypedText';
import { cn } from '@/lib/utils';
import Image from 'next/image';

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  /* ── Refs ─────────────────────────────────────────────────── */
  const bgRef      = useRef<HTMLDivElement>(null);
  const cardRef    = useRef<HTMLDivElement>(null);
  const logoRef    = useRef<HTMLDivElement>(null);
  const formRef    = useRef<HTMLFormElement>(null);
  const btnRef     = useRef<HTMLButtonElement>(null);
  const infoRef    = useRef<HTMLDivElement>(null);
  const errorRef   = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  /* ── Entrance animations ──────────────────────────────────── */
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from(bgRef.current, { opacity: 0, duration: 0.4 });
      tl.fromTo(
        logoRef.current,
        { scale: 0, rotate: -20, opacity: 0 },
        { scale: 1, rotate: 0, opacity: 1, duration: 0.65, ease: 'back.out(2)' },
        '-=0.15'
      );
      tl.fromTo(
        cardRef.current,
        { y: 56, opacity: 0, scale: 0.94 },
        { y: 0, opacity: 1, scale: 1, duration: 0.65 },
        '-=0.35'
      );
    });

    /* Floating particles */
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
          scale:   [{ to: 0 }, { to: 1   }, { to: 0 }],
          duration: () => random(4000, 8000),
          delay:    () => random(0, 3000),
          loop: true,
          ease: 'inOutSine',
        });
      }
    }

    /* Form fields stagger */
    setTimeout(() => {
      if (!formRef.current) return;
      animate(formRef.current.querySelectorAll('.form-field'), {
        opacity: [0, 1],
        translateY: [18, 0],
        duration: 440,
        delay: stagger(70, { start: 350 }),
        ease: 'outExpo',
      });
    }, 100);

    /* Info box entrance */
    setTimeout(() => {
      if (!infoRef.current) return;
      gsap.fromTo(infoRef.current,
        { x: -10, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }
      );
    }, 900);

    return () => ctx.revert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Animate error box in ─────────────────────────────────── */
  useEffect(() => {
    if (error && errorRef.current) {
      gsap.fromTo(errorRef.current,
        { opacity: 0, y: -8, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.5)' }
      );
    }
  }, [error]);

  /* ── Loading overlay animation ────────────────────────────── */
  useEffect(() => {
    if (!overlayRef.current) return;
    if (isLoading) {
      gsap.fromTo(overlayRef.current,
        { opacity: 0, backdropFilter: 'blur(0px)' },
        { opacity: 1, duration: 0.3, ease: 'power2.out' }
      );
    } else {
      gsap.to(overlayRef.current, { opacity: 0, duration: 0.25, ease: 'power2.in' });
    }
  }, [isLoading]);

  /* ── Shake card on error ──────────────────────────────────── */
  const shakeCard = () => {
    if (!cardRef.current) return;
    animate(cardRef.current, {
      translateX: [0, -8, 8, -6, 6, 0],
      duration: 420,
      ease: 'inOutSine',
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validasi password match
    if (formData.password !== formData.confirmPassword) {
      setError('Password tidak cocok');
      shakeCard();
      return;
    }

    // Validasi panjang password
    if (formData.password.length < 6) {
      setError('Password minimal 6 karakter');
      shakeCard();
      return;
    }

    setIsLoading(true);
    if (btnRef.current) gsap.to(btnRef.current, { scale: 0.97, duration: 0.15 });

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          username: formData.username,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Animate card out then redirect
        gsap.to(cardRef.current, {
          scale: 1.02, opacity: 0, y: -20, duration: 0.4, ease: 'power3.in',
          onComplete: () => router.push('/login?registered=true&needVerification=true'),
        });
      } else {
        setError(data.error || 'Registrasi gagal');
        shakeCard();
        setIsLoading(false);
        if (btnRef.current) gsap.to(btnRef.current, { scale: 1, duration: 0.15 });
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('Terjadi kesalahan. Silakan coba lagi.');
      shakeCard();
      setIsLoading(false);
      if (btnRef.current) gsap.to(btnRef.current, { scale: 1, duration: 0.15 });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 overflow-hidden" data-aos="fade-up">
      {/* Background */}
      <div ref={bgRef} className="fixed inset-0 -z-10 gradient-mesh overflow-hidden" />

      {/* Decorative rings */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-primary/5 animate-spin-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-primary/8 animate-spin-slow [animation-direction:reverse] [animation-duration:12s]" />
      </div>

      {/* Loading overlay */}
      <div
        ref={overlayRef}
        className={cn(
          'fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/60 backdrop-blur-sm pointer-events-none',
          isLoading ? 'opacity-100' : 'opacity-0'
        )}
        style={{ transition: 'none' }}
      >
        <div className="relative flex items-center justify-center w-16 h-16">
          {/* Outer spinning ring */}
          <span className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
          {/* Inner pulsing dot */}
          <span className="w-5 h-5 rounded-full bg-primary animate-pulse" />
        </div>
        <p className="text-sm font-semibold text-primary tracking-wide animate-pulse">Mendaftarkan akun…</p>
        {/* Skeleton preview strips */}
        <div className="flex flex-col gap-2 mt-2 w-48">
          <div className="h-2 rounded-full bg-primary/15 animate-pulse" />
          <div className="h-2 rounded-full bg-primary/10 animate-pulse w-3/4" />
          <div className="h-2 rounded-full bg-primary/10 animate-pulse w-1/2" />
        </div>
      </div>

      <div className="w-full max-w-md">
        {/* Logo & Header */}
        <div ref={logoRef} className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-28 h-28 mb-4 drop-shadow-xl">
            <Image src="/logo-aplikasi.png" alt="SIG ACTIVA Logo" width={112} height={112} className="object-contain" priority />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">SIG ACTIVA</h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto leading-snug">
            Sistem Informasi Akuntansi<br />PT Semen Indonesia Grup
          </p>
        </div>

        {/* Register Card */}
        <Card ref={cardRef as any} className="shadow-2xl border-0 bg-white/80 backdrop-blur-xl">
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-5">
              <UserPlus size={22} className="text-primary" />
              <h2
                id="register-title"
                className="text-xl font-bold text-foreground"
              >
                <TypedText text="Daftar Akun Baru" typeSpeed={32} startDelay={280} />
              </h2>
            </div>

            <form ref={formRef} onSubmit={handleRegister} className="space-y-4">

              {/* Name Input */}
              <div className="form-field space-y-1.5" style={{ opacity: 0 }}>
                <Label htmlFor="name">Nama Lengkap</Label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    value={formData.name}
                    onChange={handleChange}
                    className="pl-9 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="Masukkan nama lengkap"
                    required
                  />
                </div>
              </div>

              {/* Email Input */}
              <div className="form-field space-y-1.5" style={{ opacity: 0 }}>
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="pl-9 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="nama@email.com"
                    required
                  />
                </div>
              </div>

              {/* Username Input */}
              <div className="form-field space-y-1.5" style={{ opacity: 0 }}>
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    value={formData.username}
                    onChange={handleChange}
                    className="pl-9 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="Masukkan username"
                    required
                  />
                </div>
              </div>

              {/* Role Info */}
              <div ref={infoRef} className="form-field rounded-lg border border-blue-200 bg-blue-50/80 p-3 flex gap-2 items-start" style={{ opacity: 0 }}>
                <Info size={14} className="shrink-0 mt-0.5 text-blue-600" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  <span className="font-semibold">Catatan:</span> Role akun Anda akan ditentukan oleh Admin System setelah registrasi. Secara default, Anda akan mendapatkan role{' '}
                  <span className="font-semibold">Staff Accounting</span>.
                </p>
              </div>

              {/* Password Input */}
              <div className="form-field space-y-1.5" style={{ opacity: 0 }}>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleChange}
                    className="pl-9 pr-10 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="Minimal 6 karakter"
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

              {/* Confirm Password Input */}
              <div className="form-field space-y-1.5" style={{ opacity: 0 }}>
                <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="pl-9 pr-10 h-11 bg-white border-border focus-visible:ring-primary text-foreground"
                    placeholder="Ulangi password"
                    required
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div
                  ref={errorRef}
                  className="form-field rounded-lg px-3 py-2.5 text-xs border bg-destructive/5 border-destructive/20 text-destructive flex gap-2 items-start"
                >
                  <XCircle size={13} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                ref={btnRef}
                type="submit"
                disabled={isLoading}
                className={cn(
                  'form-field w-full h-11 flex items-center justify-center gap-2 rounded-lg font-semibold text-sm text-white transition-colors will-change-transform',
                  'bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary/25'
                )}
                style={{ opacity: 0 }}
              >
                {isLoading ? (
                  <><Loader2 size={15} className="animate-spin" /> Memproses...</>
                ) : (
                  <>Daftar <ArrowRight size={15} /></>
                )}
              </button>
            </form>

            {/* Login Link */}
            <div className="mt-5 pt-5 border-t border-border">
              <p className="text-center text-xs text-muted-foreground">
                Sudah punya akun?{' '}
                <Link
                  href="/login"
                  className="text-primary hover:underline font-semibold"
                >
                  Login di sini
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground mt-5">
          © 2026 SIG ACTIVA — PT Semen Indonesia Grup. All rights reserved.
        </p>
      </div>
    </div>
  );
}
