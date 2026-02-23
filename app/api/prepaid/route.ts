import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Mengambil semua data prepaid
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    let whereClause: any = {};
    if (type && type !== 'All') {
      whereClause.type = type;
    }

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
        periodes: {
          select: {
            id: true,
            periodeKe: true,
            bulan: true,
            tahun: true,
            amountPrepaid: true,
            isAmortized: true,
            amortizedDate: true
          },
          orderBy: {
            periodeKe: 'asc'
          },
          take: 100
        }
      },
      orderBy: {
        startDate: 'desc'
      },
      take: 1000
    });

    // Hitung remaining untuk setiap prepaid
    const bulanMap: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
      'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
    };
    const today = new Date();
    const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);

    const prepaidsWithRemaining = prepaids.map((prepaid: any) => {
      let amortizedAmount = 0;

      if (prepaid.pembagianType === 'otomatis') {
        // Auto: hitung hanya periode yang bulannya sudah lewat atau bulan ini
        amortizedAmount = prepaid.periodes.reduce((sum: number, p: any) => {
          const parts = p.bulan.split(' ');
          const periodeMonth = bulanMap[parts[0]] ?? 0;
          const periodeYear = parseInt(parts[1]);
          const periodeDate = new Date(periodeYear, periodeMonth, 1);
          return periodeDate <= todayFirst ? sum + p.amountPrepaid : sum;
        }, 0);
      } else {
        // Manual: sum semua amountPrepaid yang sudah diinput user
        amortizedAmount = prepaid.periodes.reduce((sum: number, p: any) => sum + p.amountPrepaid, 0);
      }
      
      return {
        ...prepaid,
        totalAmortisasi: amortizedAmount,
        remaining: prepaid.totalAmount - amortizedAmount
      };
    });

    return NextResponse.json(prepaidsWithRemaining);
  } catch (error) {
    console.error('Error fetching prepaid data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prepaid data' },
      { status: 500 }
    );
  }
}

// POST - Membuat data prepaid baru
export async function POST(request: NextRequest) {
  try {
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

    // Validasi input
    if (!kdAkr || !namaAkun || !totalAmount || !startDate || !period || !alokasi) {
      return NextResponse.json(
        { error: 'Missing required fields' },
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
      type = 'Linear', // Default to Linear if not provided
    } = body;

    // Update prepaid data
    const prepaid = await prisma.prepaid.update({
      where: { id: parseInt(id) },
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
      },
      include: {
        periodes: true
      }
    });

    return NextResponse.json(prepaid);
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

    return NextResponse.json({ message: 'Prepaid deleted successfully' });
  } catch (error) {
    console.error('Error deleting prepaid:', error);
    return NextResponse.json(
      { error: 'Failed to delete prepaid' },
      { status: 500 }
    );
  }
}
