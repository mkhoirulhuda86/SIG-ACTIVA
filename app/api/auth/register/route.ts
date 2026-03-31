import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendVerificationEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipRateLimit = checkRateLimit(`register:ip:${clientIp}`, 5, 60_000);
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan registrasi. Coba lagi sebentar.' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipRateLimit.retryAfterSec) },
        }
      );
    }

    const { username, email, password, name } = await request.json();

    if (!username || !email || !password || !name) {
      return NextResponse.json(
        { error: 'Semua field harus diisi' },
        { status: 400 }
      );
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Format email tidak valid' },
        { status: 400 }
      );
    }

    // Minimal 8 char, at least 1 uppercase, 1 lowercase, 1 number
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!strongPasswordRegex.test(password)) {
      return NextResponse.json(
        { error: 'Password minimal 8 karakter dan harus mengandung huruf besar, huruf kecil, serta angka' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return NextResponse.json(
        { error: 'Username sudah digunakan' },
        { status: 409 }
      );
    }

    // Check if email already exists
    const existingEmail = await prisma.user.findUnique({
      where: { email },
    });

    if (existingEmail) {
      return NextResponse.json(
        { error: 'Email sudah terdaftar' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create user with default role STAFF_ACCOUNTING and isApproved = false
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        name,
        role: 'STAFF_ACCOUNTING',
        isApproved: false, // Menunggu approval admin
        emailVerified: false, // Menunggu verifikasi email
        verificationToken,
      },
    });

    // Send verification email
    await sendVerificationEmail(email, verificationToken, name);

    return NextResponse.json({
      success: true,
      message: 'Registrasi berhasil! Silakan cek email Anda untuk verifikasi.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
