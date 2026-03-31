import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { broadcast } from '@/lib/sse';
import { requireAdmin } from '@/lib/api-auth';

// GET all users
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const idParam = request.nextUrl.searchParams.get('id');
    const users = await prisma.user.findMany({
      where: idParam ? { id: parseInt(idParam) } : undefined,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ success: true, users }, {
      headers: {
        // Cache for 5s, serve stale up to 30s while revalidating in background
        'Cache-Control': 'private, max-age=5, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil data users' },
      { status: 500 }
    );
  }
}

// POST create new user
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { username, email, password, name, role } = await request.json();

    if (!username || !email || !password || !name || !role) {
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

    // Create user - user yang dibuat admin langsung approved dan emailVerified
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        name,
        role,
        isApproved: true, // Admin yang buat user langsung approved
        emailVerified: true, // Email langsung terverifikasi karena dibuat oleh admin
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        isApproved: true,
        createdAt: true,
      },
    });

    broadcast('users', { id: user.id });
    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
