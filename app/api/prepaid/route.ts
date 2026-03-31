import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';

const BULAN_MAP: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
  'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11,
};

// GET - Mengambil semua data prepaid (no periodes payload) OR periodes for one item
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const type       = searchParams.get('type');
    const singleId   = searchParams.get('id');
    const withPeriodes = searchParams.get('periodes') === '1';

    // ── On-demand periodes fetch for one item ──────────────────────
    if (singleId && withPeriodes) {
      const id = parseInt(singleId);
      if (isNaN(id)) return NextResponse.json([], { status: 400 });

      const item = await prisma.prepaid.findUnique({
        where: { id },
        select: {
          pembagianType: true,
          periodes: {
            select: {
              id: true, periodeKe: true, bulan: true, tahun: true,
              amountPrepaid: true, isAmortized: true, amortizedDate: true,
              costcenters: {
                select: { id: true, costCenter: true, kdAkunBiaya: true, amount: true, headerText: true, lineText: true },
                orderBy: { id: 'asc' },
              },
            },
            orderBy: { periodeKe: 'asc' },
          },
        },
      });

      const res = NextResponse.json(item?.periodes ?? []);
      res.headers.set('Cache-Control', 'private, no-store');
      return res;
    }

    // ── Main list – periodes fetched server-side for calculation only, NOT sent to client ──
    let whereClause: any = {};
    if (type && type !== 'All') whereClause.type = type;
    if (singleId) whereClause.id = parseInt(singleId); // targeted single-item fetch

    const today      = new Date();
    const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);

    const prepaids = await prisma.prepaid.findMany({
      where: whereClause,
      select: {
        id: true,
        companyCode: true,
        noPo: true,
        alokasi: true,
        kdAkr: true,
        namaAkun: true,
        deskripsi: true,
        klasifikasi: true,
        totalAmount: true,
        startDate: true,
        period: true,
        periodUnit: true,
        pembagianType: true,
        vendor: true,
        type: true,
        headerText: true,
        costCenter: true,
        // Fetch periodes only to compute amortisasi — not sent to client
        periodes: {
          select: { bulan: true, amountPrepaid: true },
          orderBy: { periodeKe: 'asc' },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const prepaidsWithRemaining = prepaids.map((prepaid: any) => {
      let amortizedAmount = 0;

      if (prepaid.pembagianType === 'otomatis') {
        amortizedAmount = prepaid.periodes.reduce((sum: number, p: any) => {
          const parts       = p.bulan.split(' ');
          const periodeMonth = BULAN_MAP[parts[0]] ?? 0;
          const periodeYear  = parseInt(parts[1]);
          const periodeDate  = new Date(periodeYear, periodeMonth, 1);
          return periodeDate <= todayFirst ? sum + p.amountPrepaid : sum;
        }, 0);
      } else {
        amortizedAmount = prepaid.periodes.reduce((sum: number, p: any) => sum + p.amountPrepaid, 0);
      }

      // Amortisasi bulan ini: jumlahkan periode yang cocok dengan bulan & tahun saat ini
      const amortisasiBulanIni = prepaid.periodes.reduce((sum: number, p: any) => {
        const parts       = p.bulan.split(' ');
        const periodeMonth = BULAN_MAP[parts[0]] ?? 0;
        const periodeYear  = parseInt(parts[1]);
        const periodeDate  = new Date(periodeYear, periodeMonth, 1);
        return periodeDate.getTime() === todayFirst.getTime() ? sum + p.amountPrepaid : sum;
      }, 0);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { periodes: _periodes, ...rest } = prepaid; // strip periodes from response
      return {
        ...rest,
        totalAmortisasi: amortizedAmount,
        remaining: prepaid.totalAmount - amortizedAmount,
        amortisasiBulanIni,
      };
    });

    const res = NextResponse.json(prepaidsWithRemaining);
    // Light caching: browser can use stale data for 10s while revalidating
    res.headers.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    return res;
  } catch (error) {
    console.error('Error fetching prepaid data:', error);
    return NextResponse.json({ error: 'Failed to fetch prepaid data' }, { status: 500 });
  }
}

// POST - Membuat data prepaid baru
export async function POST(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const {
      companyCode,
      noPo,
      kdAkr,
      alokasi,
      namaAkun,
      vendor,
      deskripsi,
      headerText,
      klasifikasi,
      totalAmount,
      costCenter,
      startDate,
      period,
      periodUnit,
      type = 'Linear', // Default to Linear if not provided
      pembagianType,
      periodeAmounts // array untuk manual pembagian
    } = body;

    // Validasi input — hanya field yang benar-benar dibutuhkan untuk generate periode
    if (!totalAmount || !startDate || !period) {
      return NextResponse.json(
        { error: 'Field Amount, Start Date, dan Jumlah Periode wajib diisi' },
        { status: 400 }
      );
    }

    // Buat periode-periode
    const startDateObj = new Date(startDate);
    const periodes: any[] = [];

    for (let i = 0; i < period; i++) {
      const periodeDate = new Date(startDateObj);
      periodeDate.setMonth(periodeDate.getMonth() + i);
      
      const bulanNama = periodeDate.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
      const tahun = periodeDate.getFullYear();
      
      let amountPrepaid;
      if (pembagianType === 'manual') {
        // Manual: semua periode mulai dari 0, user input sendiri
        amountPrepaid = (periodeAmounts && periodeAmounts[i] !== undefined) ? periodeAmounts[i] : 0;
      } else {
        // Otomatis - bagi rata
        amountPrepaid = totalAmount / period;
      }

      periodes.push({
        periodeKe: i + 1,
        bulan: bulanNama,
        tahun: tahun,
        amountPrepaid: amountPrepaid,
        isAmortized: false
      });
    }

    // Simpan ke database
    const prepaid = await prisma.prepaid.create({
      data: {
        companyCode,
        noPo,
        kdAkr,
        alokasi,
        namaAkun,
        vendor,
        deskripsi,
        headerText,
        klasifikasi,
        totalAmount,
        remaining: totalAmount,
        costCenter,
        startDate: new Date(startDate),
        period,
        periodUnit: periodUnit || 'bulan',
        type: type || 'Linear',
        pembagianType: pembagianType || 'otomatis',
        periodes: {
          create: periodes
        }
      },
      include: {
        periodes: true
      }
    });

    broadcast('prepaid', { id: prepaid.id });
    sendPushToAll({ title: 'Prepaid Baru Ditambahkan', body: 'Data prepaid baru berhasil disimpan', url: '/monitoring-prepaid', priority: 'medium' }).catch(() => {});
    return NextResponse.json(prepaid, { status: 201 });
  } catch (error) {
    console.error('Error creating prepaid:', error);
    return NextResponse.json(
      { error: 'Failed to create prepaid' },
      { status: 500 }
    );
  }
}

// PUT - Update prepaid
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Prepaid ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      companyCode,
      noPo,
      kdAkr,
      alokasi,
      namaAkun,
      vendor,
      deskripsi,
      headerText,
      klasifikasi,
      totalAmount,
      costCenter,
      startDate,
      period,
      periodUnit,
      type = 'Linear',
      pembagianType,
      periodeAmounts,
    } = body;

    const prepaidId = parseInt(id);

    // Fetch current state to detect what changed
    const current = await prisma.prepaid.findUnique({
      where: { id: prepaidId },
      select: {
        pembagianType: true,
        totalAmount: true,
        period: true,
        startDate: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: 'Prepaid not found' }, { status: 404 });
    }

    // Determine whether periodes need to be regenerated:
    // - pembagianType changed
    // - totalAmount, period, or startDate changed
    const oldStart    = new Date(current.startDate).toISOString().split('T')[0];
    const newStart    = new Date(startDate).toISOString().split('T')[0];
    const needRegen   =
      current.pembagianType !== pembagianType ||
      current.totalAmount   !== totalAmount   ||
      current.period        !== period        ||
      oldStart              !== newStart;

    // Update scalar fields first
    const prepaid = await prisma.prepaid.update({
      where: { id: prepaidId },
      data: {
        companyCode,
        noPo,
        kdAkr,
        alokasi,
        namaAkun,
        vendor,
        deskripsi,
        headerText,
        klasifikasi,
        totalAmount,
        costCenter,
        startDate: new Date(startDate),
        period,
        periodUnit,
        type,
        pembagianType,   // ← was missing before
      },
    });

    if (needRegen) {
      // Delete existing periodes
      await prisma.prepaidPeriode.deleteMany({ where: { prepaidId } });

      // Rebuild periodes
      const startDateObj = new Date(startDate);
      const newPeriodes: any[] = [];

      for (let i = 0; i < period; i++) {
        const periodeDate = new Date(startDateObj);
        periodeDate.setMonth(periodeDate.getMonth() + i);

        const bulanNama = periodeDate.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
        const tahun = periodeDate.getFullYear();

        let amountPrepaid: number;
        if (pembagianType === 'manual') {
          amountPrepaid = (periodeAmounts && periodeAmounts[i] !== undefined) ? periodeAmounts[i] : 0;
        } else {
          amountPrepaid = totalAmount / period;
        }

        newPeriodes.push({
          prepaidId,
          periodeKe: i + 1,
          bulan: bulanNama,
          tahun,
          amountPrepaid,
          isAmortized: false,
        });
      }

      await prisma.prepaidPeriode.createMany({ data: newPeriodes });
    }

    broadcast('prepaid', { id: prepaidId });    sendPushToAll({ title: 'Prepaid Diperbarui', body: 'Data prepaid berhasil diperbarui', url: '/monitoring-prepaid', priority: 'low' }).catch(() => {});    return NextResponse.json(prepaid);
  } catch (error) {
    console.error('Error updating prepaid:', error);
    return NextResponse.json(
      { error: 'Failed to update prepaid' },
      { status: 500 }
    );
  }
}

// DELETE - Menghapus prepaid (single id atau bulk ids=1,2,3)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids');
    const id = searchParams.get('id');

    // Bulk delete
    if (ids) {
      const idList = ids.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (idList.length === 0) {
        return NextResponse.json({ error: 'Invalid ids' }, { status: 400 });
      }
      const result = await prisma.prepaid.deleteMany({
        where: { id: { in: idList } },
      });
      broadcast('prepaid', { ids: idList, action: 'delete' });
      sendPushToAll({ title: 'Prepaid Dihapus', body: `${result.count} prepaid berhasil dihapus`, url: '/monitoring-prepaid', priority: 'low' }).catch(() => {});
      return NextResponse.json({ message: `${result.count} prepaid berhasil dihapus`, count: result.count });
    }

    // Single delete
    if (!id) {
      return NextResponse.json(
        { error: 'Prepaid ID is required' },
        { status: 400 }
      );
    }

    await prisma.prepaid.delete({
      where: { id: parseInt(id) }
    });

    broadcast('prepaid', { id: parseInt(id), action: 'delete' });
    sendPushToAll({ title: 'Prepaid Dihapus', body: 'Satu entri prepaid berhasil dihapus', url: '/monitoring-prepaid', priority: 'low' }).catch(() => {});
    return NextResponse.json({ message: 'Prepaid deleted successfully' });
  } catch (error) {
    console.error('Error deleting prepaid:', error);
    return NextResponse.json(
      { error: 'Failed to delete prepaid' },
      { status: 500 }
    );
  }
}
