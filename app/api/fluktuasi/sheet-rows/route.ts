import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// ─── GET: fetch rows for one or all accounts ─────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountCode = searchParams.get('accountCode');

    if (accountCode) {
      // Single account
      const record = await prisma.fluktuasiSheetRows.findUnique({
        where: { accountCode },
      });
      if (!record) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: record });
    }

    // All accounts (metadata only — no rows, to keep response small)
    const records = await prisma.fluktuasiSheetRows.findMany({
      select: {
        accountCode: true,
        headers: true,
        originalHeaders: true,
        klasifikasiColIdx: true,
        docnoColIdx: true,
        fileName: true,
      },
      orderBy: { accountCode: 'asc' },
    });
    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error('Error fetching sheet rows:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data sheet rows' },
      { status: 500 },
    );
  }
}

// ─── POST: upsert rows for a single account ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      accountCode,
      headers,
      originalHeaders,
      klasifikasiColIdx,
      docnoColIdx,
      rows,
      fileName = '',
    } = body as {
      accountCode: string;
      headers: string[];
      originalHeaders: string[];
      klasifikasiColIdx?: number | null;
      docnoColIdx?: number | null;
      rows: Record<string, unknown>[];
      fileName?: string;
    };

    if (!accountCode || !Array.isArray(headers) || !Array.isArray(rows)) {
      return NextResponse.json(
        { success: false, error: 'accountCode, headers dan rows wajib diisi' },
        { status: 400 },
      );
    }

    const record = await prisma.fluktuasiSheetRows.upsert({
      where: { accountCode },
      update: {
        headers:           headers         as Prisma.InputJsonValue,
        originalHeaders:   originalHeaders as Prisma.InputJsonValue,
        klasifikasiColIdx: klasifikasiColIdx ?? null,
        docnoColIdx:       docnoColIdx ?? null,
        rows:              rows            as Prisma.InputJsonValue,
        fileName,
      },
      create: {
        accountCode,
        headers:           headers         as Prisma.InputJsonValue,
        originalHeaders:   originalHeaders as Prisma.InputJsonValue,
        klasifikasiColIdx: klasifikasiColIdx ?? null,
        docnoColIdx:       docnoColIdx ?? null,
        rows:              rows            as Prisma.InputJsonValue,
        fileName,
      },
    });

    return NextResponse.json({ success: true, id: record.id });
  } catch (error) {
    console.error('Error upserting sheet rows:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menyimpan sheet rows' },
      { status: 500 },
    );
  }
}

// ─── DELETE: wipe all sheet rows ─────────────────────────────────────────────
export async function DELETE() {
  try {
    const { count } = await prisma.fluktuasiSheetRows.deleteMany();
    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Error deleting sheet rows:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus sheet rows' },
      { status: 500 },
    );
  }
}
