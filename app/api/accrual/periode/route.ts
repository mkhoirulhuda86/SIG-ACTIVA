import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';

// PUT - Update periode amount
export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const body = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Missing periode ID' },
        { status: 400 }
      );
    }

    const { amountAccrual } = body;

    if (amountAccrual === undefined || amountAccrual === null) {
      return NextResponse.json(
        { error: 'Missing amount accrual' },
        { status: 400 }
      );
    }

    // Update periode amount (accrual disimpan positif)
    const periode = await prisma.accrualPeriode.update({
      where: {
        id: parseInt(id),
      },
      data: {
        amountAccrual: Math.abs(parseFloat(amountAccrual)),
      },
      include: {
        accrual: {
          select: {
            id: true,
          },
        },
      },
    });

    // Keep parent totalAmount in sync with latest periode amounts
    const totalAgg = await prisma.accrualPeriode.aggregate({
      where: { accrualId: periode.accrual.id },
      _sum: { amountAccrual: true },
    });
    await prisma.accrual.update({
      where: { id: periode.accrual.id },
      data: { totalAmount: Math.abs(totalAgg._sum.amountAccrual ?? 0) },
    });
    broadcast('accrual', { id: periode.accrual.id });

    return NextResponse.json(periode);
  } catch (error) {
    console.error('Error updating periode:', error);
    return NextResponse.json(
      { error: 'Failed to update periode' },
      { status: 500 }
    );
  }
}
