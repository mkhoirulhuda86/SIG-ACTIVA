import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';

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

    const res = NextResponse.json({ success: true, data: records });
    // Allow CDN/browser to serve stale while revalidating (30 s fresh, 60 s stale)
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching akun periodes:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data akun periode' },
      { status: 500 },
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

    // Batch upsert: update if (accountCode, periode) exists, insert otherwise
    const results = await Promise.allSettled(
      records.map((r) =>
        prisma.fluktuasiAkunPeriode.upsert({
          where: { accountCode_periode: { accountCode: r.accountCode, periode: r.periode } },
          update: {
            amount:      r.amount,
            klasifikasi: r.klasifikasi,
            remark:      r.remark,
            uploadedBy,
            fileName,
          },
          create: {
            accountCode: r.accountCode,
            periode:     r.periode,
            amount:      r.amount,
            klasifikasi: r.klasifikasi,
            remark:      r.remark,
            uploadedBy,
            fileName,
          },
        }),
      ),
    );

    const failed  = results.filter((r) => r.status === 'rejected').length;
    const success = results.length - failed;

    broadcast('fluktuasi');
    sendPushToAll({ title: 'Data Fluktuasi Diperbarui', body: `${success} record fluktuasi berhasil disimpan`, url: '/fluktuasi-oi', priority: 'medium' }).catch(() => {});
    return NextResponse.json({
      success: true,
      message: `${success} record berhasil disimpan${failed ? `, ${failed} gagal` : ''}`,
      saved: success,
      failed,
    });
  } catch (error) {
    console.error('Error upserting akun periodes:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menyimpan data akun periode' },
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
      { success: false, error: 'Gagal menghapus data akun periode' },
      { status: 500 },
    );
  }
}
