'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, XCircle, Mail } from 'lucide-react';
import Link from 'next/link';
import { gsap } from 'gsap';
import TypedText from '@/app/components/TypedText';

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  // ── Animation refs ────────────────────────────────────────────────────────
  const headerRef = useRef<HTMLDivElement>(null);
  const cardRef   = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // ── Page entrance animation ───────────────────────────────────────────────
  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    if (headerRef.current)
      tl.fromTo(headerRef.current, { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: 0.55 }, 0);
    if (cardRef.current)
      tl.fromTo(cardRef.current, { opacity: 0, y: 32, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6 }, 0.12);
  }, []);

  // ── Status change animation ───────────────────────────────────────────────
  useEffect(() => {
    if (status === 'loading' || !statusRef.current) return;
    gsap.fromTo(statusRef.current,
      { opacity: 0, scale: 0.92, y: 18 },
      { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'back.out(1.5)' }
    );
  }, [status]);

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Token verifikasi tidak ditemukan');
      return;
    }

    verifyEmail(token);
  }, [searchParams]);

  const verifyEmail = async (token: string) => {
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus('success');
        setMessage(data.message);
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          router.push('/login?verified=true');
        }, 3000);
      } else {
        setStatus('error');
        setMessage(data.error || 'Verifikasi email gagal');
      }
    } catch (error) {
      console.error('Verification error:', error);
      setStatus('error');
      setMessage('Terjadi kesalahan. Silakan coba lagi.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-gray-100 flex items-center justify-center px-4" data-aos="fade-up">
      <div className="w-full max-w-md">
        {/* Logo & Header */}
        <div ref={headerRef} className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-600 rounded-2xl mb-4 shadow-lg">
            <div className="text-white font-bold text-2xl">SIG</div>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            <TypedText text="Verifikasi Email" typeSpeed={30} startDelay={220} />
          </h1>
          <p className="text-gray-600">
            SIG ACTIVA - PT Semen Indonesia Grup
          </p>
        </div>

        {/* Verification Card */}
        <div ref={cardRef} className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          {status === 'loading' && (
            <div className="text-center py-8">
              {/* Spinner ring matching other pages */}
              <div className="relative w-16 h-16 mx-auto mb-5">
                <div className="absolute inset-0 rounded-full border-4 border-red-100" />
                <div className="absolute inset-0 rounded-full border-4 border-t-red-600 border-r-red-300 border-b-transparent border-l-transparent animate-spin" />
                <Mail className="absolute inset-0 m-auto w-7 h-7 text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Memverifikasi Email...
              </h2>
              <p className="text-gray-500 text-sm mb-4">
                Mohon tunggu sebentar
              </p>
              {/* Bouncing dots matching other pages */}
              <div className="flex justify-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-red-500 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {status === 'success' && (
            <div ref={statusRef} className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Email Terverifikasi!
              </h2>
              <p className="text-gray-600 mb-6">
                {message}
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Langkah Selanjutnya:</strong><br/>
                  Akun Anda menunggu persetujuan dari Admin System. Anda akan menerima notifikasi ketika akun sudah disetujui.
                </p>
              </div>
              <p className="text-sm text-gray-500">
                Mengalihkan ke halaman login...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div ref={statusRef} className="text-center py-8">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Verifikasi Gagal
              </h2>
              <p className="text-gray-600 mb-6">
                {message}
              </p>
              <Link
                href="/login"
                className="inline-block bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
              >
                Kembali ke Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
