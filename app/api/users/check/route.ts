import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRateLimit = checkRateLimit(`users-check:ip:${clientIp}`, 10, 60_000);
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

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Return generic status to reduce account enumeration risk
      return NextResponse.json({
        success: true,
        user: { emailVerified: false, isApproved: false },
      });
    }

    return NextResponse.json({
      success: true,
      user: {
        emailVerified: user.emailVerified,
        isApproved: user.isApproved,
      },
    });
  } catch (error) {
    console.error('Check user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
