import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';
import { createSessionToken, getSessionCookieName, getSessionMaxAgeSeconds } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRateLimit = checkRateLimit(`login:ip:${clientIp}`, 10, 60_000);
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan login. Coba lagi sebentar.' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipRateLimit.retryAfterSec) },
        }
      );
    }

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email dan password harus diisi' },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Email atau password salah' },
        { status: 401 }
      );
    }

    // Auto-verify dan approve admin yang sudah ada sebelumnya
    if (user.role === 'ADMIN_SYSTEM' && (!user.emailVerified || !user.isApproved)) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          isApproved: true,
          verificationToken: null,
        },
      });
      user.emailVerified = true;
      user.isApproved = true;
    }

    // Auto-fix: Jika user sudah approved tapi email belum verified, auto verify
    // Ini untuk handle kasus dimana admin approve sebelum user klik link email
    if (user.isApproved && !user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          verificationToken: null,
        },
      });
      user.emailVerified = true;
    }

    // Check if email is verified (skip for admin yang baru di-update)
    if (!user.emailVerified) {
      return NextResponse.json(
        { error: 'Email Anda belum diverifikasi. Silakan cek email untuk link verifikasi.' },
        { status: 403 }
      );
    }

    // Check if user is approved (skip for admin yang baru di-update)
    if (!user.isApproved) {
      return NextResponse.json(
        { error: 'Akun Anda belum disetujui oleh Admin System. Silakan hubungi administrator.' },
        { status: 403 }
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Email atau password salah' },
        { status: 401 }
      );
    }

    const token = await createSessionToken({
      uid: user.id,
      role: user.role,
      name: user.name,
    });

    // Return user data (excluding password)
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
    response.cookies.set({
      name: getSessionCookieName(),
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: getSessionMaxAgeSeconds(),
    });
    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
