import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = parseInt(id);
    const body = await request.json();
    const { isApproved, role } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Update user approval status and role
    // Ketika admin approve, otomatis verifikasi email juga
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        isApproved: isApproved,
        role: role || 'STAFF_ACCOUNTING',
        emailVerified: isApproved ? true : undefined, // Auto verify email when approved
        verificationToken: isApproved ? null : undefined, // Clear token when approved
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        isApproved: true,
        emailVerified: true,
      },
    });

    broadcast('users');
    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Error approving user:', error);
    return NextResponse.json(
      { error: 'Failed to approve user' },
      { status: 500 }
    );
  }
}
