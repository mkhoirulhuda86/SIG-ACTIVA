import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const dbErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  if (/planLimitReached/i.test(message)) {
    return 'Koneksi database ditolak: limit paket Prisma sudah tercapai (planLimitReached).';
  }
  if (/P1001|Can\'t reach database server/i.test(message)) {
    return 'Koneksi database gagal (P1001): server database tidak terjangkau.';
  }
  return fallback;
};

// GET: Ambil data fluktuasi terakhir
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const uploadedBy = searchParams.get('uploadedBy') || 'system';
    
    // Ambil data terakhir berdasarkan user
    const latestData = await prisma.fluktuasiImport.findFirst({
      where: { uploadedBy },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestData) {
      return NextResponse.json({ 
        success: false, 
        message: 'Tidak ada data fluktuasi tersimpan' 
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: latestData.id,
        fileName: latestData.fileName,
        sheetDataList: latestData.sheetDataList,
        rekapSheetData: latestData.rekapSheetData,
        createdAt: latestData.createdAt,
      },
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('Error loading fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal memuat data fluktuasi') },
      { status: 500 }
    );
  }
}

// POST: Simpan data fluktuasi baru
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName, sheetDataList, rekapSheetData, uploadedBy = 'system' } = body;

    if (!fileName || !sheetDataList) {
      return NextResponse.json(
        { success: false, error: 'fileName dan sheetDataList wajib diisi' },
        { status: 400 }
      );
    }

    // Simpan data baru
    const saved = await prisma.fluktuasiImport.create({
      data: {
        fileName,
        uploadedBy,
        sheetDataList,
        rekapSheetData: rekapSheetData || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Data fluktuasi berhasil disimpan',
      data: {
        id: saved.id,
        fileName: saved.fileName,
        createdAt: saved.createdAt,
      },
    });
  } catch (error) {
    console.error('Error saving fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menyimpan data fluktuasi') },
      { status: 500 }
    );
  }
}

// DELETE: Hapus data fluktuasi lama (optional, untuk cleanup)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const uploadedBy = searchParams.get('uploadedBy') || 'system';
    const keepLast = parseInt(searchParams.get('keepLast') || '5', 10);

    // Ambil semua data user, urutkan dari terbaru
    const allData = await prisma.fluktuasiImport.findMany({
      where: { uploadedBy },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    // Tentukan data yang akan dihapus (lewati `keepLast` data terakhir)
    const toDelete = allData.slice(keepLast).map((d: { id: number }) => d.id);

    if (toDelete.length > 0) {
      await prisma.fluktuasiImport.deleteMany({
        where: { id: { in: toDelete } },
      });
    }

    return NextResponse.json({
      success: true,
      message: `${toDelete.length} data lama berhasil dihapus`,
      deleted: toDelete.length,
    });
  } catch (error) {
    console.error('Error deleting old fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menghapus data lama') },
      { status: 500 }
    );
  }
}
