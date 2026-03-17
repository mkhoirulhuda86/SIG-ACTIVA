import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';

const dbErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  if (/planLimitReached/i.test(message)) {
    return 'Koneksi database ditolak: limit paket Prisma sudah tercapai (planLimitReached).';
  }
  if (/P1001|Can\'t reach database server/i.test(message)) {
    return 'Koneksi database gagal (P1001): server database tidak terjangkau.';
  }
  return 'Gagal memuat keywords';
};

// GET: Ambil semua keywords
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'klasifikasi' atau 'remark'
    
    const keywords = await prisma.fluktuasiKeyword.findMany({
      where: type ? { type } : undefined,
      orderBy: [
        { priority: 'desc' },
        { keyword: 'asc' },
      ],
    });

    return NextResponse.json({
      success: true,
      data: keywords.map((kw) => ({
        ...kw,
        keyword: kw.keyword ?? '',
        result: kw.result ?? '',
        accountCodes: kw.accountCodes ?? '',
        sourceColumn: kw.sourceColumn ?? '',
      })),
    });
  } catch (error) {
    console.error('Error loading keywords:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST: Tambah keyword baru
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, type, result, priority = 0 } = body;

    if (!keyword || !type) {
      return NextResponse.json(
        { success: false, error: 'keyword dan type wajib diisi' },
        { status: 400 }
      );
    }

    // For regex/not/col keywords, result can be empty
    const isSpecialMode = keyword.toLowerCase().startsWith('regex:') || keyword.toLowerCase().startsWith('not:') || keyword.toLowerCase().startsWith('col:');
    if (!isSpecialMode && !result) {
      return NextResponse.json(
        { success: false, error: 'result wajib diisi untuk keyword biasa' },
        { status: 400 }
      );
    }

    if (!['klasifikasi', 'remark'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'type harus "klasifikasi" atau "remark"' },
        { status: 400 }
      );
    }

    // Check for duplicate keyword (case-insensitive) with same type AND same accountCodes
    const existingKeyword = await prisma.fluktuasiKeyword.findFirst({
      where: {
        keyword: {
          equals: keyword.trim(),
          mode: 'insensitive',
        },
        type,
        accountCodes: (body.accountCodes ?? '').trim(),
      },
    });

    if (existingKeyword) {
      const acctLabel = (body.accountCodes ?? '').trim() || 'semua akun';
      return NextResponse.json(
        { success: false, error: `Keyword "${keyword}" dengan type "${type}" untuk akun "${acctLabel}" sudah ada. Silakan gunakan keyword yang berbeda.` },
        { status: 400 }
      );
    }

    const created = await prisma.fluktuasiKeyword.create({
      data: {
        keyword: keyword.trim(),
        type,
        result: (result ?? '').trim(),
        priority: parseInt(priority, 10) || 0,
        accountCodes: (body.accountCodes ?? '').trim(),
        sourceColumn: (body.sourceColumn ?? '').trim(),
      },
    });

    broadcast('fluktuasi');
    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil ditambahkan',
      data: created,
    });
  } catch (error) {
    console.error('Error creating keyword:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error) },
      { status: 500 }
    );
  }
}

// PUT: Update keyword
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, keyword, type, result, priority } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id wajib diisi' },
        { status: 400 }
      );
    }

    const data: any = {};
    if (keyword !== undefined) data.keyword = keyword.trim();
    if (type !== undefined) {
      if (!['klasifikasi', 'remark'].includes(type)) {
        return NextResponse.json(
          { success: false, error: 'type harus "klasifikasi" atau "remark"' },
          { status: 400 }
        );
      }
      data.type = type;
    }
    if (result !== undefined) data.result = result.trim();
    if (priority !== undefined) data.priority = parseInt(priority, 10);
    if (body.accountCodes !== undefined) data.accountCodes = (body.accountCodes ?? '').trim();
    if (body.sourceColumn !== undefined) data.sourceColumn = (body.sourceColumn ?? '').trim();

    // Check for duplicate keyword when updating (exclude current record)
    if (keyword !== undefined && type !== undefined) {
      const newAccountCodes = body.accountCodes !== undefined
        ? (body.accountCodes ?? '').trim()
        : (await prisma.fluktuasiKeyword.findUnique({ where: { id: parseInt(id, 10) } }))?.accountCodes ?? '';

      const existingKeyword = await prisma.fluktuasiKeyword.findFirst({
        where: {
          keyword: {
            equals: keyword.trim(),
            mode: 'insensitive',
          },
          type,
          accountCodes: newAccountCodes,
          id: {
            not: parseInt(id, 10),
          },
        },
      });

      if (existingKeyword) {
        const acctLabel = newAccountCodes || 'semua akun';
        return NextResponse.json(
          { success: false, error: `Keyword "${keyword}" dengan type "${type}" untuk akun "${acctLabel}" sudah ada. Silakan gunakan keyword yang berbeda.` },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.fluktuasiKeyword.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    broadcast('fluktuasi');
    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil diupdate',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating keyword:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error) },
      { status: 500 }
    );
  }
}

// DELETE: Hapus keyword (id=<n>) atau semua (all=true)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id  = searchParams.get('id');
    const all = searchParams.get('all');

    if (all === 'true') {
      const { count } = await prisma.fluktuasiKeyword.deleteMany({});
      broadcast('fluktuasi');
      return NextResponse.json({
        success: true,
        message: `${count} keyword berhasil dihapus`,
      });
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id wajib diisi' },
        { status: 400 }
      );
    }

    await prisma.fluktuasiKeyword.delete({
      where: { id: parseInt(id, 10) },
    });

    broadcast('fluktuasi');
    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil dihapus',
    });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error) },
      { status: 500 }
    );
  }
}
