import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';

// GET - Fetch all accrual data with periodes and realisasi
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');

    const where: {
      OR?: { 
        kdAkr?: { contains: string; mode: 'insensitive' }; 
        kdAkunBiaya?: { contains: string; mode: 'insensitive' }; 
        vendor?: { contains: string; mode: 'insensitive' }; 
        deskripsi?: { contains: string; mode: 'insensitive' };
        companyCode?: { contains: string; mode: 'insensitive' };
        noPo?: { contains: string; mode: 'insensitive' };
      }[];
    } = {};

    // Filter by search term
    if (search) {
      where.OR = [
        { kdAkr: { contains: search, mode: 'insensitive' } },
        { kdAkunBiaya: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
        { deskripsi: { contains: search, mode: 'insensitive' } },
        { companyCode: { contains: search, mode: 'insensitive' } },
        { noPo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const accruals = await prisma.accrual.findMany({
      where,
      select: {
        id: true,
        companyCode: true,
        noPo: true,
        kdAkr: true,
        alokasi: true,
        kdAkunBiaya: true,
        vendor: true,
        deskripsi: true,
        headerText: true,
        klasifikasi: true,
        totalAmount: true,
        saldoAwal: true,
        costCenter: true,
        startDate: true,
        jumlahPeriode: true,
        pembagianType: true,
        createdAt: true,
        periodes: {
          select: {
            id: true,
            periodeKe: true,
            bulan: true,
            tahun: true,
            amountAccrual: true,
            realisasis: {
              select: {
                id: true,
                tanggalRealisasi: true,
                amount: true,
                headerText: true,
                lineText: true,
                keterangan: true,
                kdAkunBiaya: true,
                costCenter: true
              }
            },
            costcenters: {
              select: {
                id: true,
                costCenter: true,
                kdAkunBiaya: true,
                amount: true,
                headerText: true,
                lineText: true,
                keterangan: true
              },
              orderBy: { createdAt: 'asc' }
            }
          },
          orderBy: {
            periodeKe: 'asc',
          },
          take: 100
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 1000
    });

    // Calculate total realisasi and saldo for each periode with rollover
    const accrualsWithCalculations = accruals.map((accrual: any) => {
      let rollover = 0; // Track kelebihan realisasi dari periode sebelumnya
      
      return {
        ...accrual,
        periodes: accrual.periodes.map((periode: any) => {
          // Calculate totalRealisasi from actual realisasi data (semua positif)
          const totalRealisasi = periode.realisasis?.reduce((sum: number, r: any) => sum + r.amount, 0) || 0;
          
          // Total available termasuk rollover dari periode sebelumnya
          const totalAvailable = totalRealisasi + rollover;
          const capAccrual = Math.abs(periode.amountAccrual); // amountAccrual sekarang positif
          
          // Efektif realisasi adalah minimum antara available dan cap accrual periode
          const effectiveRealisasi = Math.min(totalAvailable, capAccrual);
          
          // Saldo = accrual dikurangi realisasi (semua positif)
          const accrualAbs = Math.abs(periode.amountAccrual);
          const saldo = accrualAbs - effectiveRealisasi;
          
          // Update rollover untuk periode berikutnya (kelebihan realisasi)
          rollover = Math.max(0, totalAvailable - capAccrual);
          
          return {
            ...periode,
            totalRealisasi,
            saldo,
          };
        }),
      };
    });

    const res = NextResponse.json(accrualsWithCalculations);
    // Allow browser/CDN to cache for 15 s, serve stale up to 60 s while revalidating
    res.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('Error fetching accruals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accruals' },
      { status: 500 }
    );
  }
}

// POST - Create new accrual entry with periodes
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      companyCode, noPo, kdAkr, alokasi, kdAkunBiaya, vendor, deskripsi, headerText, klasifikasi,
      totalAmount, saldoAwal, costCenter, startDate, jumlahPeriode, pembagianType, periodeAmounts 
    } = body;

    // Validate required fields (totalAmount boleh 0 untuk tipe manual)
    const hasRequired =
      kdAkr != null && kdAkr !== '' &&
      kdAkunBiaya != null && kdAkunBiaya !== '' &&
      vendor != null && vendor !== '' &&
      deskripsi != null && deskripsi !== '' &&
      totalAmount != null && totalAmount !== '' &&
      startDate != null && startDate !== '' &&
      jumlahPeriode != null && jumlahPeriode !== '';
    if (!hasRequired) {
      return NextResponse.json(
        { error: 'Missing required fields', details: 'kdAkr, kdAkunBiaya, vendor, deskripsi, totalAmount, startDate, dan jumlahPeriode harus diisi' },
        { status: 400 }
      );
    }

    // Generate periodes data
    const start = new Date(startDate);
    const periodes = [];
    
    for (let i = 0; i < parseInt(jumlahPeriode); i++) {
      const periodeDate = new Date(start);
      periodeDate.setMonth(start.getMonth() + i);
      
      const bulanNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const bulan = `${bulanNames[periodeDate.getMonth()]} ${periodeDate.getFullYear()}`;
      
      let amountAccrual;
      if (pembagianType === 'otomatis') {
        amountAccrual = Math.abs(parseFloat(totalAmount) / parseInt(jumlahPeriode));
      } else {
        amountAccrual = periodeAmounts && periodeAmounts[i] ? Math.abs(parseFloat(periodeAmounts[i])) : 0;
      }
      
      periodes.push({
        periodeKe: i + 1,
        bulan,
        tahun: periodeDate.getFullYear(),
        amountAccrual,
      });
    }

    // Create accrual with periodes (totalAmount & amountAccrual disimpan positif; realisasi positif; saldo = saldoAwal + totalAccrual - realisasi)
    const accrual = await prisma.accrual.create({
      data: {
        companyCode: companyCode || null,
        noPo: noPo || null,
        kdAkr,
        alokasi: alokasi || null,
        kdAkunBiaya,
        vendor,
        deskripsi,
        headerText: headerText || null,
        klasifikasi: klasifikasi || null,
        totalAmount: Math.abs(parseFloat(totalAmount)),
        saldoAwal: saldoAwal != null && saldoAwal !== '' ? parseFloat(saldoAwal) : null,
        costCenter: costCenter || null,
        startDate: new Date(startDate),
        jumlahPeriode: parseInt(jumlahPeriode),
        pembagianType: pembagianType || 'otomatis',
        periodes: {
          create: periodes,
        },
      },
      include: {
        periodes: true,
      },
    });

    broadcast('accrual');
    return NextResponse.json(accrual, { status: 201 });
  } catch (error) {
    console.error('Error creating accrual:', error);
    return NextResponse.json(
      { error: 'Failed to create accrual', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete accrual entry (single id) atau bulk (ids=1,2,3)
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids');

    if (idsParam) {
      // Bulk delete: satu request, cascade hapus periode & realisasi
      const ids = idsParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) {
        return NextResponse.json(
          { error: 'Invalid or empty ids' },
          { status: 400 }
        );
      }
      const result = await prisma.accrual.deleteMany({
        where: { id: { in: ids } },
      });
      broadcast('accrual');
      return NextResponse.json({
        message: `${result.count} accrual berhasil dihapus`,
        count: result.count,
      });
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Missing accrual ID or ids' },
        { status: 400 }
      );
    }

    await prisma.accrual.delete({
      where: {
        id: parseInt(id),
      },
    });

    broadcast('accrual');
    return NextResponse.json({ message: 'Accrual deleted successfully' });
  } catch (error) {
    console.error('Error deleting accrual:', error);
    return NextResponse.json(
      { error: 'Failed to delete accrual' },
      { status: 500 }
    );
  }
}

// PATCH/PUT - Update accrual entry
export async function PATCH(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const body = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Missing accrual ID' },
        { status: 400 }
      );
    }

    const { 
      companyCode, noPo, kdAkr, alokasi, kdAkunBiaya, vendor, deskripsi, headerText, klasifikasi,
      totalAmount, saldoAwal, costCenter, startDate, jumlahPeriode, pembagianType, periodeAmounts 
    } = body;

    // Validate required fields (totalAmount boleh 0 untuk tipe manual)
    const hasRequired =
      kdAkr != null && kdAkr !== '' &&
      kdAkunBiaya != null && kdAkunBiaya !== '' &&
      vendor != null && vendor !== '' &&
      deskripsi != null && deskripsi !== '' &&
      totalAmount != null && totalAmount !== '' &&
      startDate != null && startDate !== '' &&
      jumlahPeriode != null && jumlahPeriode !== '';
    if (!hasRequired) {
      return NextResponse.json(
        { error: 'Missing required fields', details: 'kdAkr, kdAkunBiaya, vendor, deskripsi, totalAmount, startDate, dan jumlahPeriode harus diisi' },
        { status: 400 }
      );
    }

    // Get existing periodes
    const existingPeriodes = await prisma.accrualPeriode.findMany({
      where: {
        accrualId: parseInt(id),
      },
      orderBy: {
        periodeKe: 'asc',
      },
    });

    // Generate new periodes data
    const start = new Date(startDate);
    const newJumlahPeriode = parseInt(jumlahPeriode);
    const existingCount = existingPeriodes.length;
    
    // Update accrual basic info first
    await prisma.accrual.update({
      where: {
        id: parseInt(id),
      },
      data: {
        companyCode: companyCode || null,
        noPo: noPo || null,
        kdAkr,
        alokasi: alokasi || null,
        kdAkunBiaya,
        vendor,
        deskripsi,
        headerText: headerText || null,
        klasifikasi: klasifikasi || null,
        totalAmount: Math.abs(parseFloat(totalAmount)),
        ...(saldoAwal != null && saldoAwal !== '' && { saldoAwal: parseFloat(saldoAwal) }),
        costCenter: costCenter || null,
        startDate: new Date(startDate),
        jumlahPeriode: newJumlahPeriode,
        pembagianType,
      },
    });

    // Update or create periodes (amountAccrual disimpan positif)
    for (let i = 0; i < newJumlahPeriode; i++) {
      const periodeDate = new Date(start);
      periodeDate.setMonth(start.getMonth() + i);
      
      const bulanNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const bulan = `${bulanNames[periodeDate.getMonth()]} ${periodeDate.getFullYear()}`;
      
      let amountAccrual;
      if (pembagianType === 'otomatis') {
        amountAccrual = Math.abs(parseFloat(totalAmount) / newJumlahPeriode);
      } else {
        amountAccrual = periodeAmounts && periodeAmounts[i] ? Math.abs(parseFloat(periodeAmounts[i])) : 0;
      }

      // If periode already exists, update it (preserve realisasi data)
      if (i < existingCount) {
        await prisma.accrualPeriode.update({
          where: {
            id: existingPeriodes[i].id,
          },
          data: {
            bulan,
            tahun: periodeDate.getFullYear(),
            amountAccrual,
            periodeKe: i + 1,
          },
        });
      } else {
        // Create new periode if it doesn't exist
        await prisma.accrualPeriode.create({
          data: {
            accrualId: parseInt(id),
            periodeKe: i + 1,
            bulan,
            tahun: periodeDate.getFullYear(),
            amountAccrual,
          },
        });
      }
    }

    // Delete excess periodes if jumlah periode decreased
    if (newJumlahPeriode < existingCount) {
      const periodesToDelete = existingPeriodes.slice(newJumlahPeriode);
      await prisma.accrualPeriode.deleteMany({
        where: {
          id: {
            in: periodesToDelete.map(p => p.id),
          },
        },
      });
    }

    // Fetch updated accrual with periodes
    const accrual = await prisma.accrual.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        periodes: {
          orderBy: {
            periodeKe: 'asc',
          },
        },
      },
    });

    broadcast('accrual');
    return NextResponse.json(accrual);
  } catch (error) {
    console.error('Error updating accrual:', error);
    return NextResponse.json(
      { error: 'Failed to update accrual', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const PUT = PATCH; // Alias PUT to PATCH

