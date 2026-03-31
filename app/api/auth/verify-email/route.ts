import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendAdminNotification } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRateLimit = checkRateLimit(`verify-email:ip:${clientIp}`, 10, 60_000);
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan verifikasi. Coba lagi sebentar.' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipRateLimit.retryAfterSec) },
        }
      );
    }

    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Token verifikasi diperlukan' },
        { status: 400 }
      );
    }

    // Find user by verification token
    const user = await prisma.user.findUnique({
      where: { verificationToken: token },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Token verifikasi tidak valid atau sudah kadaluarsa' },
        { status: 404 }
      );
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { success: true, message: 'Email sudah diverifikasi sebelumnya' },
        { status: 200 }
      );
    }

    // Update user to verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null, // Clear token after verification
      },
    });

    // Send notification to admin
    try {
      await sendAdminNotification(user.name, user.email, user.id);
    } catch (emailError) {
      console.error('Failed to send admin notification:', emailError);
      // Don't fail verification if email fails
    }

    return NextResponse.json({
      success: true,
      message: 'Email berhasil diverifikasi! Akun Anda menunggu persetujuan dari Admin System.',
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
