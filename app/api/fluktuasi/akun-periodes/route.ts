import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';
import { checkFluktuasiAlerts } from '@/lib/notificationChecker';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';
import { logAuditEvent } from '@/lib/audit';

const dbErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  if (/planLimitReached/i.test(message)) {
    return 'Koneksi database ditolak: limit paket Prisma sudah tercapai (planLimitReached).';
  }
  if (/P1001|Can\'t reach database server/i.test(message)) {
    return 'Koneksi database gagal (P1001): server database tidak terjangkau.';
  }
  if (/timeout|timed out|Connection terminated unexpectedly/i.test(message)) {
    return 'Koneksi database timeout saat memproses batch import.';
  }

  return fallback;
};

// ─── GET: Ambil semua account-period records ─────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceRead(req);
    if ('error' in auth) return auth.error;

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

    const res = NextResponse.json({ success: true, data: records });
    // Allow CDN/browser to serve stale while revalidating (30 s fresh, 60 s stale)
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching akun periodes:', error);
    return NextResponse.json(
      { success: false, error: dbErrorMessage(error, 'Gagal mengambil data akun periode') },
      { status: 500 },
    );
  }
}

// ─── POST: Batch upsert account-period records ───────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceWrite(req);
    if ('error' in auth) return auth.error;

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

    // Normalisasi + deduplicate berdasarkan accountCode + periode
    const dedupedMap = new Map<string, {
      accountCode: string;
      periode: string;
      amount: number;
      klasifikasi: string;
      remark: string;
    }>();

    for (const r of records) {
      const accountCode = String(r.accountCode ?? '').trim();
      const periode = String(r.periode ?? '').trim();
      if (!accountCode || !periode) continue;

      dedupedMap.set(`${accountCode}__${periode}`, {
        accountCode,
        periode,
        amount: Number(r.amount ?? 0),
        klasifikasi: String(r.klasifikasi ?? '').trim(),
        remark: String(r.remark ?? '').trim(),
      });
    }

    const normalizedRecords = [...dedupedMap.values()];

    if (normalizedRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Tidak ada record valid untuk disimpan' },
        { status: 400 },
      );
    }

    const uniqKeys = normalizedRecords.map((r) => ({
      accountCode: r.accountCode,
      periode: r.periode,
    }));

    const existingRows = await prisma.fluktuasiAkunPeriode.findMany({
      where: {
        OR: uniqKeys.map((k) => ({
          accountCode: k.accountCode,
          periode: k.periode,
        })),
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

    const failedItems: { accountCode: string; periode: string; error: string }[] = [];
    let saved = 0;
    const CHUNK_SIZE = 50;

    const buildUpsert = (r: {
      accountCode: string;
      periode: string;
      amount: number;
      klasifikasi: string;
      remark: string;
    }) => {
      const existing = existingMap.get(`${r.accountCode}__${r.periode}`);
      const keepExistingAmount =
        !!existing && Number(r.amount) === 0 && Number(existing.amount) !== 0;

      const effectiveAmount = keepExistingAmount ? existing.amount : r.amount;
      const effectiveKlasifikasi =
        String(r.klasifikasi ?? '').trim() || existing?.klasifikasi || '';
      const effectiveRemark =
        String(r.remark ?? '').trim() || existing?.remark || '';

      return prisma.fluktuasiAkunPeriode.upsert({
        where: {
          accountCode_periode: {
            accountCode: r.accountCode,
            periode: r.periode,
          },
        },
        update: {
          amount: effectiveAmount,
          klasifikasi: effectiveKlasifikasi,
          remark: effectiveRemark,
          uploadedBy,
          fileName,
        },
        create: {
          accountCode: r.accountCode,
          periode: r.periode,
          amount: effectiveAmount,
          klasifikasi: effectiveKlasifikasi,
          remark: effectiveRemark,
          uploadedBy,
          fileName,
        },
      });
    };

    for (let i = 0; i < normalizedRecords.length; i += CHUNK_SIZE) {
      const chunk = normalizedRecords.slice(i, i + CHUNK_SIZE);

      try {
        await prisma.$transaction(
          chunk.map((r) => buildUpsert(r)),
          { timeout: 30000 }
        );
        saved += chunk.length;
      } catch (chunkError) {
        console.warn(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1} gagal, fallback row-by-row`, chunkError);

        for (const r of chunk) {
          try {
            await buildUpsert(r);
            saved += 1;
          } catch (rowError) {
            failedItems.push({
              accountCode: r.accountCode,
              periode: r.periode,
              error: rowError instanceof Error ? rowError.message : String(rowError),
            });
          }
        }
      }
    }

    const failed = failedItems.length;

    broadcast('fluktuasi');
    logAuditEvent({
      request: req,
      user: auth.user,
      action: 'fluktuasi.akun_periode.upsert_batch',
      success: failed === 0,
      detail: `saved=${saved}, failed=${failed}`,
    });

    sendPushToAll({
      title: 'Data Fluktuasi Diperbarui',
      body: `${saved} record fluktuasi berhasil disimpan`,
      url: '/fluktuasi-oi',
      priority: 'medium',
    }).catch(() => {});

    checkFluktuasiAlerts().catch(() => {});

    return NextResponse.json({
      success: true,
      partial: failed > 0,
      message:
        failed > 0
          ? `${saved} record berhasil disimpan, ${failed} gagal`
          : `${saved} record berhasil disimpan`,
      saved,
      failed,
      failedItems: failedItems.slice(0, 20),
      totalReceived: records.length,
      totalProcessed: normalizedRecords.length,
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
    const auth = await requireFinanceWrite(req);
    if ('error' in auth) return auth.error;

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
    logAuditEvent({ request: req, user: auth.user, action: 'fluktuasi.akun_periode.delete', success: true, detail: `deleted=${deleted.count}` });
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
