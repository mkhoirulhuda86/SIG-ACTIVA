import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - List all cost center entries for a periode
export async function GET(request: NextRequest) {
  try {
    const periodeId = request.nextUrl.searchParams.get('periodeId');
    if (!periodeId) {
      return NextResponse.json({ error: 'Missing periodeId' }, { status: 400 });
    }

    const entries = await prisma.accrualPeriodeCostCenter.findMany({
      where: { accrualPeriodeId: parseInt(periodeId) },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Error fetching cost center entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

// POST - Add a cost center entry and recalculate amountAccrual
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accrualPeriodeId, costCenter, kdAkunBiaya, amount, keterangan } = body;

    if (!accrualPeriodeId || amount === undefined || amount === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const entry = await prisma.accrualPeriodeCostCenter.create({
      data: {
        accrualPeriodeId: parseInt(accrualPeriodeId),
        costCenter: costCenter || null,
        kdAkunBiaya: kdAkunBiaya || null,
        amount: parseFloat(amount),
        keterangan: keterangan || null,
      },
    });

    // Recalculate amountAccrual = sum of all cost center entries for this periode
    await recalcPeriodeAmount(parseInt(accrualPeriodeId));

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Error creating cost center entry:', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}

// PUT - Update a cost center entry and recalculate
export async function PUT(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await request.json();
    const { costCenter, kdAkunBiaya, amount, keterangan } = body;

    const entry = await prisma.accrualPeriodeCostCenter.update({
      where: { id: parseInt(id) },
      data: {
        costCenter: costCenter || null,
        kdAkunBiaya: kdAkunBiaya || null,
        amount: parseFloat(amount),
        keterangan: keterangan || null,
      },
    });

    await recalcPeriodeAmount(entry.accrualPeriodeId);

    return NextResponse.json(entry);
  } catch (error) {
    console.error('Error updating cost center entry:', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

// DELETE - Single (?id=X) or bulk (?ids=X,Y,Z)
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const idsParam = request.nextUrl.searchParams.get('ids');

    if (idsParam) {
      const ids = idsParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));

      if (ids.length === 0) return NextResponse.json({ error: 'Invalid ids' }, { status: 400 });

      // Find periodeId before deleting
      const first = await prisma.accrualPeriodeCostCenter.findUnique({
        where: { id: ids[0] },
        select: { accrualPeriodeId: true },
      });

      const result = await prisma.accrualPeriodeCostCenter.deleteMany({
        where: { id: { in: ids } },
      });

      if (first) await recalcPeriodeAmount(first.accrualPeriodeId);

      return NextResponse.json({ message: `${result.count} entries deleted`, count: result.count });
    }

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const entry = await prisma.accrualPeriodeCostCenter.delete({
      where: { id: parseInt(id) },
    });

    await recalcPeriodeAmount(entry.accrualPeriodeId);

    return NextResponse.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('Error deleting cost center entry:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}

// Helper: recalculate amountAccrual for a periode as sum of its cost center entries
async function recalcPeriodeAmount(accrualPeriodeId: number) {
  const agg = await prisma.accrualPeriodeCostCenter.aggregate({
    where: { accrualPeriodeId },
    _sum: { amount: true },
  });

  const newAmount = agg._sum.amount ?? 0;
  await prisma.accrualPeriode.update({
    where: { id: accrualPeriodeId },
    data: { amountAccrual: newAmount },
  });
}
