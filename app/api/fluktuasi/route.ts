import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

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

type SnapshotSheet = Record<string, unknown> & { sheetName: string };

const toSnapshotSheet = (value: unknown): SnapshotSheet | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sheetName = String(record.sheetName ?? '').trim();
  if (!sheetName) return null;
  return { ...record, sheetName };
};

const getSnapshotSheets = (value: unknown): SnapshotSheet[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(toSnapshotSheet)
    .filter((sheet): sheet is SnapshotSheet => sheet !== null);
};

const isUsableRekapSnapshot = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.rows) && record.rows.length > 0 &&
    Array.isArray(record.amountCols) && record.amountCols.length > 0
  );
};

const REKAP_RECOVERY_WINDOW_MS = 2 * 60 * 1000;

// GET: Ambil data fluktuasi terakhir. Database selalu menjadi source of truth.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceRead(req);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(req.url);
    const uploadedBy = searchParams.get('uploadedBy') || 'system';

    const [latestData, persistedSheets] = await Promise.all([
      prisma.fluktuasiImport.findFirst({
        where: { uploadedBy },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.fluktuasiSheetRows.findMany({
        select: {
          accountCode: true,
          headers: true,
          originalHeaders: true,
          klasifikasiColIdx: true,
          docnoColIdx: true,
          fileName: true,
          updatedAt: true,
        },
        orderBy: { accountCode: 'asc' },
      }),
    ]);

    if (!latestData) {
      return NextResponse.json(
        {
          success: false,
          message: 'Tidak ada data fluktuasi tersimpan',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    // saveToDatabase dapat membuat beberapa snapshot berurutan untuk file yang sama
    // (full -> compact -> null fallback). Jika snapshot terakhir hanya berisi JSON null,
    // pulihkan rekap valid dari retry yang sama dalam jendela waktu yang sempit.
    let rekapSheetData = latestData.rekapSheetData;
    let rekapSnapshotId = latestData.id;

    if (!isUsableRekapSnapshot(rekapSheetData)) {
      const recentSnapshots = await prisma.fluktuasiImport.findMany({
        where: {
          uploadedBy,
          fileName: latestData.fileName,
          createdAt: {
            gte: new Date(latestData.createdAt.getTime() - REKAP_RECOVERY_WINDOW_MS),
            lte: latestData.createdAt,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          rekapSheetData: true,
        },
      });

      const recovered = recentSnapshots.find((snapshot) =>
        isUsableRekapSnapshot(snapshot.rekapSheetData),
      );

      if (recovered) {
        rekapSheetData = recovered.rekapSheetData;
        rekapSnapshotId = recovered.id;
      }
    }

    // fluktuasi_imports menyimpan snapshot ringan (rows dikosongkan agar payload kecil).
    // Daftar account/sheet yang benar direkonstruksi dari FluktuasiSheetRows sehingga
    // browser baru tidak bergantung pada IndexedDB browser yang melakukan upload.
    const snapshotSheets = getSnapshotSheets(latestData.sheetDataList);
    const persistedByCode = new Map(
      persistedSheets.map((sheet) => [String(sheet.accountCode).trim(), sheet] as const),
    );
    const seen = new Set<string>();
    const mergedSheets: Record<string, unknown>[] = [];

    for (const sheet of snapshotSheets) {
      const code = sheet.sheetName.trim();
      if (!code) continue;
      seen.add(code);
      const persisted = persistedByCode.get(code);

      if (persisted) {
        mergedSheets.push({
          ...sheet,
          sheetName: code,
          headers: persisted.headers,
          originalHeaders: persisted.originalHeaders,
          klasifikasiColIdx: persisted.klasifikasiColIdx,
          docnoColIdx: persisted.docnoColIdx,
          rows: [],
        });
      } else {
        mergedSheets.push({
          ...sheet,
          sheetName: code,
          rows: Array.isArray(sheet.rows) ? sheet.rows : [],
        });
      }
    }

    // Append akun yang sudah tersimpan di database tetapi tidak ada di snapshot import
    // terakhir. Ini penting pada mode append lintas periode/browser.
    for (const persisted of persistedSheets) {
      const code = String(persisted.accountCode).trim();
      if (!code || seen.has(code)) continue;
      mergedSheets.push({
        sheetName: code,
        headers: persisted.headers,
        originalHeaders: persisted.originalHeaders,
        klasifikasiColIdx: persisted.klasifikasiColIdx,
        docnoColIdx: persisted.docnoColIdx,
        rows: [],
      });
    }

    const sheetRowsUpdatedAt = persistedSheets.reduce<Date | null>((latest, sheet) => {
      if (!latest || sheet.updatedAt.getTime() > latest.getTime()) return sheet.updatedAt;
      return latest;
    }, null);

    return NextResponse.json(
      {
        success: true,
        data: {
          id: latestData.id,
          fileName: latestData.fileName,
          sheetDataList: mergedSheets,
          rekapSheetData,
          rekapSnapshotId,
          rekapRecovered: rekapSnapshotId !== latestData.id,
          createdAt: latestData.createdAt,
          updatedAt: latestData.updatedAt,
          sheetRowsUpdatedAt,
          sheetRowsCount: persistedSheets.length,
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error loading fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal memuat data fluktuasi') },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// POST: Simpan data fluktuasi baru
export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceWrite(req);
    if ('error' in auth) return auth.error;

    const body = await req.json();
    const { fileName, sheetDataList, rekapSheetData, uploadedBy = 'system' } = body;

    if (!fileName || !sheetDataList) {
      return NextResponse.json(
        { success: false, error: 'fileName dan sheetDataList wajib diisi' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const saved = await prisma.fluktuasiImport.create({
      data: {
        fileName,
        uploadedBy,
        sheetDataList,
        rekapSheetData: rekapSheetData || null,
      },
    });

    broadcast('fluktuasi');

    return NextResponse.json(
      {
        success: true,
        message: 'Data fluktuasi berhasil disimpan',
        data: {
          id: saved.id,
          fileName: saved.fileName,
          createdAt: saved.createdAt,
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error saving fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menyimpan data fluktuasi') },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// DELETE: Hapus data fluktuasi lama (optional, untuk cleanup)
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireFinanceWrite(req);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(req.url);
    const uploadedBy = searchParams.get('uploadedBy') || 'system';
    const keepLast = parseInt(searchParams.get('keepLast') || '5', 10);

    const allData = await prisma.fluktuasiImport.findMany({
      where: { uploadedBy },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const toDelete = allData.slice(keepLast).map((d: { id: number }) => d.id);

    if (toDelete.length > 0) {
      await prisma.fluktuasiImport.deleteMany({
        where: { id: { in: toDelete } },
      });
      broadcast('fluktuasi');
    }

    return NextResponse.json(
      {
        success: true,
        message: `${toDelete.length} data lama berhasil dihapus`,
        deleted: toDelete.length,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error deleting old fluktuasi data:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menghapus data lama') },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
