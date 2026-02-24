import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
      data: keywords,
    });
  } catch (error) {
    console.error('Error loading keywords:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memuat keywords' },
      { status: 500 }
    );
  }
}

// POST: Tambah keyword baru
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, type, result, priority = 0 } = body;

    if (!keyword || !type || !result) {
      return NextResponse.json(
        { success: false, error: 'keyword, type, dan result wajib diisi' },
        { status: 400 }
      );
    }

    if (!['klasifikasi', 'remark'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'type harus "klasifikasi" atau "remark"' },
        { status: 400 }
      );
    }

    // Check for duplicate keyword (case-insensitive) with same type
    const existingKeyword = await prisma.fluktuasiKeyword.findFirst({
      where: {
        keyword: {
          equals: keyword.trim(),
          mode: 'insensitive',
        },
        type,
      },
    });

    if (existingKeyword) {
      return NextResponse.json(
        { success: false, error: `Keyword "${keyword}" dengan type "${type}" sudah ada. Silakan gunakan keyword yang berbeda.` },
        { status: 400 }
      );
    }

    const created = await prisma.fluktuasiKeyword.create({
      data: {
        keyword: keyword.trim(),
        type,
        result: result.trim(),
        priority: parseInt(priority, 10) || 0,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil ditambahkan',
      data: created,
    });
  } catch (error) {
    console.error('Error creating keyword:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menambahkan keyword' },
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

    // Check for duplicate keyword when updating (exclude current record)
    if (keyword !== undefined && type !== undefined) {
      const existingKeyword = await prisma.fluktuasiKeyword.findFirst({
        where: {
          keyword: {
            equals: keyword.trim(),
            mode: 'insensitive',
          },
          type,
          id: {
            not: parseInt(id, 10),
          },
        },
      });

      if (existingKeyword) {
        return NextResponse.json(
          { success: false, error: `Keyword "${keyword}" dengan type "${type}" sudah ada. Silakan gunakan keyword yang berbeda.` },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.fluktuasiKeyword.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil diupdate',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating keyword:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengupdate keyword' },
      { status: 500 }
    );
  }
}

// DELETE: Hapus keyword
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id wajib diisi' },
        { status: 400 }
      );
    }

    await prisma.fluktuasiKeyword.delete({
      where: { id: parseInt(id, 10) },
    });

    return NextResponse.json({
      success: true,
      message: 'Keyword berhasil dihapus',
    });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menghapus keyword' },
      { status: 500 }
    );
  }
}
