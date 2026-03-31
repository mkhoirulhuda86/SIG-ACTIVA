import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';
import { logAuditEvent } from '@/lib/audit';

// GET - List all cost center entries for a prepaid periode
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const periodeId = request.nextUrl.searchParams.get('periodeId');
    if (!periodeId) {
      return NextResponse.json({ error: 'Missing periodeId' }, { status: 400 });
    }

    const entries = await prisma.prepaidPeriodeCostCenter.findMany({
      where: { prepaidPeriodeId: parseInt(periodeId) },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Error fetching prepaid cost center entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

// POST - Add a cost center entry and recalculate amountPrepaid
export async function POST(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { prepaidPeriodeId, costCenter, kdAkunBiaya, amount, headerText, lineText } = body;

    if (!prepaidPeriodeId || amount === undefined || amount === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const entry = await prisma.prepaidPeriodeCostCenter.create({
      data: {
        prepaidPeriodeId: parseInt(prepaidPeriodeId),
        costCenter: costCenter || null,
        kdAkunBiaya: kdAkunBiaya || null,
        amount: parseFloat(amount),
        headerText: headerText || null,
        lineText: lineText || null,
      },
    });

    await recalcPeriodeAmount(parseInt(prepaidPeriodeId));

    const periodeRef1 = await prisma.prepaidPeriode.findUnique({
      where: { id: parseInt(prepaidPeriodeId) },
      select: { prepaidId: true },
    });
    broadcast('prepaid', periodeRef1?.prepaidId ? { id: periodeRef1.prepaidId } : {});
    logAuditEvent({ request, user: auth.user, action: 'prepaid.costcenter.create', target: String(prepaidPeriodeId), success: true });
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Error creating prepaid cost center entry:', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}

// PUT - Update a cost center entry and recalculate
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await request.json();
    const { costCenter, kdAkunBiaya, amount, headerText, lineText } = body;

    const entry = await prisma.prepaidPeriodeCostCenter.update({
      where: { id: parseInt(id) },
      data: {
        costCenter: costCenter || null,
        kdAkunBiaya: kdAkunBiaya || null,
        amount: parseFloat(amount),
        headerText: headerText || null,
        lineText: lineText || null,
      },
    });

    await recalcPeriodeAmount(entry.prepaidPeriodeId);

    const periodeRef2 = await prisma.prepaidPeriode.findUnique({
      where: { id: entry.prepaidPeriodeId },
      select: { prepaidId: true },
    });
    broadcast('prepaid', periodeRef2?.prepaidId ? { id: periodeRef2.prepaidId } : {});
    logAuditEvent({ request, user: auth.user, action: 'prepaid.costcenter.update', target: id ?? '', success: true });
    return NextResponse.json(entry);
  } catch (error) {
    console.error('Error updating prepaid cost center entry:', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

// DELETE - Single (?id=X) or bulk (?ids=X,Y,Z)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    const idsParam = request.nextUrl.searchParams.get('ids');

    if (idsParam) {
      const ids = idsParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));

      if (ids.length === 0) return NextResponse.json({ error: 'Invalid ids' }, { status: 400 });

      const first = await prisma.prepaidPeriodeCostCenter.findUnique({
        where: { id: ids[0] },
        select: { prepaidPeriodeId: true },
      });

      const result = await prisma.prepaidPeriodeCostCenter.deleteMany({
        where: { id: { in: ids } },
      });

      if (first) {
        await recalcPeriodeAmount(first.prepaidPeriodeId);
        const periodeRef3 = await prisma.prepaidPeriode.findUnique({
          where: { id: first.prepaidPeriodeId },
          select: { prepaidId: true },
        });
        broadcast('prepaid', periodeRef3?.prepaidId ? { id: periodeRef3.prepaidId } : {});
      } else {
        broadcast('prepaid');
      }
      logAuditEvent({ request, user: auth.user, action: 'prepaid.costcenter.bulk_delete', target: ids.join(','), success: true });
      return NextResponse.json({ message: `${result.count} entries deleted`, count: result.count });
    }

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const entry = await prisma.prepaidPeriodeCostCenter.delete({
      where: { id: parseInt(id) },
    });

    await recalcPeriodeAmount(entry.prepaidPeriodeId);

    const periodeRef4 = await prisma.prepaidPeriode.findUnique({
      where: { id: entry.prepaidPeriodeId },
      select: { prepaidId: true },
    });
    broadcast('prepaid', periodeRef4?.prepaidId ? { id: periodeRef4.prepaidId } : {});
    logAuditEvent({ request, user: auth.user, action: 'prepaid.costcenter.delete', target: id ?? '', success: true });
    return NextResponse.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('Error deleting prepaid cost center entry:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}

// Helper: recalculate amountPrepaid for a periode as sum of its cost center entries
async function recalcPeriodeAmount(prepaidPeriodeId: number) {
  const agg = await prisma.prepaidPeriodeCostCenter.aggregate({
    where: { prepaidPeriodeId },
    _sum: { amount: true },
  });

  const newAmount = agg._sum.amount ?? 0;
  await prisma.prepaidPeriode.update({
    where: { id: prepaidPeriodeId },
    data: { amountPrepaid: newAmount },
  });
}
