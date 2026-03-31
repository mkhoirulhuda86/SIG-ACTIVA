import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRateLimit = checkRateLimit(`force-verify:ip:${clientIp}`, 20, 60_000);
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak request. Coba lagi sebentar.' },
        { status: 429, headers: { 'Retry-After': String(ipRateLimit.retryAfterSec) } }
      );
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email diperlukan' },
        { status: 400 }
      );
    }

    // Force verify user by email
    const user = await prisma.user.update({
      where: { email },
      data: {
        emailVerified: true,
        verificationToken: null,
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        emailVerified: true,
        isApproved: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'User berhasil di-verify manual',
      user,
    });
  } catch (error: unknown) {
    console.error('Force verify error:', error);
    const message = error instanceof Error ? error.message : 'Failed to verify user';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
