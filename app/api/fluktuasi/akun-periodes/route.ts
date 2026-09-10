import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';
import { checkFluktuasiAlerts } from '@/lib/notificationChecker';

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

// ─── GET: Ambil semua account-period records ─────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountCode = searchParams.get('accountCode');
    const periode     = searchParams.get('periode');
    // "slim" mode: overview page only needs these 5 fields — skip heavy cols
    const slim = searchParams.get('slim') === '1';

    const records = await prisma.fluktuasiAkunPeriode.findMany({
      where: {
        ...(accountCode ? { accountCode } : {}),
        ...(periode     ? { periode }     : {}),
      },
      // skip uploadedBy / fileName / createdAt / updatedAt / remark for slim
      select: slim
        ? { accountCode: true, periode: true, amount: true, klasifikasi: true }
        : undefined,
      // client sorts anyway — skip DB sort in slim mode to reduce query cost
      orderBy: slim ? undefined : [{ accountCode: 'asc' }, { periode: 'asc' }],
    });

    return NextResponse.json(
      { success: true, data: records },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error fetching akun periodes:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal mengambil data akun periode') },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// ─── POST: Batch upsert account-period records ───────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { records, uploadedBy = 'system', fileName = '' } = body as {
      records: {
        accountCode: string;
        periode: string;
        amount: number;
        klasifikasi: string;
        remark: string;
      }[];
      uploadedBy?: string;
      fileName?: string;
    };

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'records harus berupa array tidak kosong' },
        { status: 400 },
      );
    }

    // Deduplicate by unique key to avoid concurrent upserts targeting the same
    // accountCode+periode pair (can trigger transient write conflicts).
    const normalizedMap = new Map<string, {
      accountCode: string;
      periode: string;
      amount: number;
      klasifikasi: string;
      remark: string;
    }>();
    for (const rec of records) {
      const accountCode = String(rec.accountCode ?? '').trim();
      const periode = String(rec.periode ?? '').trim();
      if (!accountCode || !periode) continue;
      const amountNum = Number(rec.amount ?? 0);
      normalizedMap.set(`${accountCode}__${periode}`, {
        accountCode,
        periode,
        amount: Number.isFinite(amountNum) ? amountNum : 0,
        klasifikasi: String(rec.klasifikasi ?? ''),
        remark: String(rec.remark ?? ''),
      });
    }
    const normalizedRecords = [...normalizedMap.values()];
    if (normalizedRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'records valid tidak ditemukan' },
        { status: 400 },
      );
    }

    // Preserve previously stored non-zero amounts when a newer upload sends 0
    // for the same account+periode key.
    const uniqKeys = [...new Set(normalizedRecords.map((r) => `${r.accountCode}__${r.periode}`))]
      .map((k) => {
        const [accountCode, periode] = k.split('__');
        return { accountCode, periode };
      });

    const existingRows = await prisma.fluktuasiAkunPeriode.findMany({
      where: {
        OR: uniqKeys.map((k) => ({ accountCode: k.accountCode, periode: k.periode })),
      },
      select: {
        accountCode: true,
        periode: true,
        amount: true,
        klasifikasi: true,
        remark: true,
      },
    });

    const existingMap = new Map<string, { amount: number; klasifikasi: string; remark: string }>();
    for (const row of existingRows) {
      existingMap.set(`${row.accountCode}__${row.periode}`, {
        amount: row.amount,
        klasifikasi: row.klasifikasi ?? '',
        remark: row.remark ?? '',
      });
    }

    // Batch upsert in small chunks to avoid connection spikes when uploading
    // large files (previously this caused partial save failures on production DB).
    const UPSERT_BATCH_SIZE = 100;
    const UPSERT_CONCURRENCY = 10;
    let success = 0;
    let failed = 0;
    const failedSamples: string[] = [];

    const upsertOne = (r: {
      accountCode: string;
      periode: string;
      amount: number;
      klasifikasi: string;
      remark: string;
    }) => {
      const existing = existingMap.get(`${r.accountCode}__${r.periode}`);
      const keepExistingAmount = !!existing && Number(r.amount) === 0 && Number(existing.amount) !== 0;
      const effectiveAmount = keepExistingAmount ? existing.amount : r.amount;
      const effectiveKlasifikasi = String(r.klasifikasi ?? '').trim() || existing?.klasifikasi || '';
      const effectiveRemark = String(r.remark ?? '').trim() || existing?.remark || '';

      return prisma.fluktuasiAkunPeriode.upsert({
        where: { accountCode_periode: { accountCode: r.accountCode, periode: r.periode } },
        update: {
          amount:      effectiveAmount,
          klasifikasi: effectiveKlasifikasi,
          remark:      effectiveRemark,
          uploadedBy,
          fileName,
        },
        create: {
          accountCode: r.accountCode,
          periode:     r.periode,
          amount:      effectiveAmount,
          klasifikasi: effectiveKlasifikasi,
          remark:      effectiveRemark,
          uploadedBy,
          fileName,
        },
      });
    };

    const runLimited = async (rows: typeof normalizedRecords) => {
      const failedRows: typeof normalizedRecords = [];
      for (let i = 0; i < rows.length; i += UPSERT_CONCURRENCY) {
        const part = rows.slice(i, i + UPSERT_CONCURRENCY);
        const results = await Promise.allSettled(part.map((r) => upsertOne(r)));
        results.forEach((result, idx) => {
          if (result.status === 'fulfilled') {
            success++;
            return;
          }
          failedRows.push(part[idx]);
          if (failedSamples.length < 5) {
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason ?? 'Unknown upsert error');
            failedSamples.push(message);
          }
        });
      }
      return failedRows;
    };

    for (let i = 0; i < normalizedRecords.length; i += UPSERT_BATCH_SIZE) {
      const chunk = normalizedRecords.slice(i, i + UPSERT_BATCH_SIZE);
      const retryRows = await runLimited(chunk);
      if (!retryRows.length) continue;

      // retry once for transient DB conflicts/timeouts
      const retryFailed = await runLimited(retryRows);
      failed += retryFailed.length;
    }

    broadcast('fluktuasi');
    sendPushToAll({ title: 'Data Fluktuasi Diperbarui', body: `${success} record fluktuasi berhasil disimpan`, url: '/fluktuasi-oi', priority: 'medium' }).catch(() => {});
    checkFluktuasiAlerts().catch(() => {});
    return NextResponse.json({
      success: true,
      message: `${success} record berhasil disimpan${failed ? `, ${failed} gagal` : ''}`,
      received: records.length,
      processed: normalizedRecords.length,
      saved: success,
      failed,
      failedSamples,
    });
  } catch (error) {
    console.error('Error upserting akun periodes:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menyimpan data akun periode') },
      { status: 500 },
    );
  }
}

// ─── DELETE: Hapus semua record (atau per accountCode) ───────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountCode = searchParams.get('accountCode');
    const periode     = searchParams.get('periode');

    const deleted = await prisma.fluktuasiAkunPeriode.deleteMany({
      where: {
        ...(accountCode ? { accountCode } : {}),
        ...(periode     ? { periode }     : {}),
      },
    });

    broadcast('fluktuasi');
    sendPushToAll({ title: 'Data Fluktuasi Dihapus', body: `${deleted.count} record fluktuasi berhasil dihapus`, url: '/fluktuasi-oi', priority: 'low' }).catch(() => {});
    return NextResponse.json({
      success: true,
      message: `${deleted.count} record berhasil dihapus`,
      count: deleted.count,
    });
  } catch (error) {
    console.error('Error deleting akun periodes:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal menghapus data akun periode') },
      { status: 500 },
    );
  }
}
