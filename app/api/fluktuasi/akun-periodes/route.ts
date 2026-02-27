import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';

// ─── GET: Ambil semua account-period records ─────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountCode = searchParams.get('accountCode');
    const periode     = searchParams.get('periode');

    const records = await prisma.fluktuasiAkunPeriode.findMany({
      where: {
        ...(accountCode ? { accountCode } : {}),
        ...(periode     ? { periode }     : {}),
      },
      orderBy: [{ accountCode: 'asc' }, { periode: 'asc' }],
    });

    return NextResponse.json({ success: true, data: records });
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
