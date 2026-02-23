import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PUT - Tandai periode sebagai telah diamortisasi
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { periodeId, isAmortized, amortizedDate, amountPrepaid } = body;

    if (!periodeId) {
      return NextResponse.json(
        { error: 'Periode ID is required' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (amountPrepaid !== undefined) {
      updateData.amountPrepaid = amountPrepaid;
      updateData.isAmortized = amountPrepaid > 0;
      if (amountPrepaid > 0) updateData.amortizedDate = new Date();
    } else {
      if (isAmortized !== undefined) updateData.isAmortized = isAmortized;
      if (amortizedDate) updateData.amortizedDate = new Date(amortizedDate);
      else if (isAmortized) updateData.amortizedDate = new Date();
    }

    const periode = await prisma.prepaidPeriode.update({
      where: { id: periodeId },
      data: updateData
    });

    // Update remaining di prepaid utama
    const prepaidPeriodes = await prisma.prepaidPeriode.findMany({
      where: { prepaidId: periode.prepaidId }
    });

    const prepaid = await prisma.prepaid.findUnique({
      where: { id: periode.prepaidId }
    });

    if (prepaid) {
      let amortizedAmount = 0;

      if (prepaid.pembagianType === 'otomatis') {
        const bulanMap: Record<string, number> = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
          'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
        };
        const today = new Date();
        const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);
        amortizedAmount = prepaidPeriodes.reduce((sum: number, p: any) => {
          const parts = p.bulan.split(' ');
          const periodeMonth = bulanMap[parts[0]] ?? 0;
          const periodeYear = parseInt(parts[1]);
          const periodeDate = new Date(periodeYear, periodeMonth, 1);
          return periodeDate <= todayFirst ? sum + p.amountPrepaid : sum;
        }, 0);
      } else {
        amortizedAmount = prepaidPeriodes.reduce((sum: number, p: any) => sum + p.amountPrepaid, 0);
      }

      await prisma.prepaid.update({
        where: { id: periode.prepaidId },
        data: {
          remaining: prepaid.totalAmount - amortizedAmount
        }
      });
    }

    return NextResponse.json(periode);
  } catch (error) {
    console.error('Error updating periode:', error);
    return NextResponse.json(
      { error: 'Failed to update periode' },
      { status: 500 }
    );
  }
}
