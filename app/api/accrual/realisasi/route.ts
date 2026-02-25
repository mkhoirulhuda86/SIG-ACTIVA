import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Add realisasi to a periode
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accrualPeriodeId, tanggalRealisasi, amount, headerText, lineText, keterangan, kdAkunBiaya, costCenter } = body;

    if (!accrualPeriodeId || !tanggalRealisasi || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const realisasi = await prisma.accrualRealisasi.create({
      data: {
        accrualPeriodeId: parseInt(accrualPeriodeId),
        tanggalRealisasi: new Date(tanggalRealisasi),
        amount: Math.abs(parseFloat(amount)), // realisasi disimpan positif
        headerText: headerText || null,
        lineText: lineText || null,
        keterangan: keterangan || null,
        kdAkunBiaya: kdAkunBiaya || null,
        costCenter: costCenter || null,
      },
    });

    return NextResponse.json(realisasi, { status: 201 });
  } catch (error) {
    console.error('Error creating realisasi:', error);
    return NextResponse.json(
      { error: 'Failed to create realisasi' },
      { status: 500 }
    );
  }
}

// GET - Get all realisasi for a periode
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const periodeId = searchParams.get('periodeId');

    if (!periodeId) {
      return NextResponse.json(
        { error: 'Missing periode ID' },
        { status: 400 }
      );
    }

    const realisasis = await prisma.accrualRealisasi.findMany({
      where: {
        accrualPeriodeId: parseInt(periodeId),
      },
      orderBy: {
        tanggalRealisasi: 'desc',
      },
    });

    return NextResponse.json(realisasis);
  } catch (error) {
    console.error('Error fetching realisasis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch realisasis' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a realisasi (single: ?id=x, bulk: ?ids=1,2,3)
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids');

    // Bulk delete
    if (idsParam) {
      const ids = idsParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));

      if (ids.length === 0) {
        return NextResponse.json(
          { error: 'Invalid or empty ids' },
          { status: 400 }
        );
      }

      const result = await prisma.accrualRealisasi.deleteMany({
        where: { id: { in: ids } },
      });

      return NextResponse.json({
        message: `${result.count} realisasi berhasil dihapus`,
        count: result.count,
      });
    }

    // Single delete
    if (!id) {
      return NextResponse.json(
        { error: 'Missing realisasi ID' },
        { status: 400 }
      );
    }

    await prisma.accrualRealisasi.delete({
      where: {
        id: parseInt(id),
      },
    });

    return NextResponse.json({ message: 'Realisasi deleted successfully' });
  } catch (error) {
    console.error('Error deleting realisasi:', error);
    return NextResponse.json(
      { error: 'Failed to delete realisasi' },
      { status: 500 }
    );
  }
}

// PUT - Update a realisasi
export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const body = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Missing realisasi ID' },
        { status: 400 }
      );
    }

    const { tanggalRealisasi, amount, headerText, lineText, keterangan, kdAkunBiaya, costCenter } = body;

    if (!tanggalRealisasi || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const realisasi = await prisma.accrualRealisasi.update({
      where: {
        id: parseInt(id),
      },
      data: {
        tanggalRealisasi: new Date(tanggalRealisasi),
        amount: Math.abs(parseFloat(amount)), // realisasi disimpan positif
        headerText: headerText || null,
        lineText: lineText || null,
        keterangan: keterangan || null,
        kdAkunBiaya: kdAkunBiaya || null,
        costCenter: costCenter || null,
      },
    });

    return NextResponse.json(realisasi);
  } catch (error) {
    console.error('Error updating realisasi:', error);
    return NextResponse.json(
      { error: 'Failed to update realisasi' },
      { status: 500 }
    );
  }
}
