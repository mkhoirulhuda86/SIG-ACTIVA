import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const notifications: any[] = [];
    const today = new Date();

    // 1. Check Accrual Periodes that need realization
    const accruals = await prisma.accrual.findMany({
      select: {
        id: true,
        vendor: true,
        deskripsi: true,
        kdAkr: true,
        periodes: {
          select: {
            id: true,
            periodeKe: true,
            bulan: true,
            amountAccrual: true,
            realisasis: {
              select: {
                amount: true
              }
            }
          },
          take: 20,
          where: { bulan: { not: '' } }
        }
      },
      take: 30
    });

    accruals.forEach((accrual) => {
      accrual.periodes.forEach((periode) => {
        // Parse periode date
        const [bulanName, tahunStr] = periode.bulan.split(' ');
        const bulanMap: { [key: string]: number } = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
          'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
        };
        const periodeBulan = bulanMap[bulanName];
        const periodeTahun = parseInt(tahunStr);
        const periodeDate = new Date(periodeTahun, periodeBulan, 1);

        // Check if periode has passed
        if (today >= periodeDate) {
          const totalRealisasi = periode.realisasis.reduce((sum, r) => sum + Math.abs(r.amount), 0);
          const accrualAbs = Math.abs(periode.amountAccrual);
          const saldo = accrualAbs - totalRealisasi;

          // If saldo > 50% of amount, create notification
          if (saldo > accrualAbs * 0.5) {
            notifications.push({
              id: `accrual-${periode.id}`,
              type: 'accrual',
              title: 'Accrual Perlu Direalisasi',
              message: `${accrual.vendor} - ${accrual.kdAkr} periode ${periode.bulan} memiliki saldo Rp ${saldo.toLocaleString('id-ID')}`,
              link: '/monitoring-accrual',
              priority: saldo > periode.amountAccrual * 0.8 ? 'high' : 'medium',
              createdAt: periodeDate.toISOString()
            });
          }
        }
      });
    });

    // 2. Check Prepaid Periodes that need amortization
    const prepaids = await prisma.prepaid.findMany({
      select: {
        id: true,
        vendor: true,
        namaAkun: true,
        kdAkr: true,
        periodes: {
          select: {
            id: true,
            periodeKe: true,
            bulan: true,
            amountPrepaid: true,
            isAmortized: true
          },
          take: 20,
          where: { bulan: { not: '' } }
        }
      },
      take: 30
    });

    prepaids.forEach((prepaid) => {
      prepaid.periodes.forEach((periode) => {
        // Parse periode date
        const [bulanName, tahunStr] = periode.bulan.split(' ');
        const bulanMap: { [key: string]: number } = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
          'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
        };
        const periodeBulan = bulanMap[bulanName];
        const periodeTahun = parseInt(tahunStr);
        const periodeDate = new Date(periodeTahun, periodeBulan, 1);

        // Check if periode has passed and not amortized
        if (today >= periodeDate && !periode.isAmortized) {
          notifications.push({
            id: `prepaid-${periode.id}`,
            type: 'prepaid',
            title: 'Prepaid Perlu Diamortisasi',
            message: `${prepaid.vendor} - ${prepaid.kdAkr} periode ${periode.bulan} belum diamortisasi (Rp ${periode.amountPrepaid.toLocaleString('id-ID')})`,
            link: '/monitoring-prepaid',
            priority: 'medium',
            createdAt: periodeDate.toISOString()
          });
        }
      });
    });

    // 3. Check Material Data with high discrepancies
    const latestMaterialDate = await prisma.materialData.findFirst({
      select: { importDate: true },
      orderBy: { importDate: 'desc' }
    });

    if (latestMaterialDate) {
      const materialData = await prisma.materialData.findMany({
        where: {
          importDate: latestMaterialDate.importDate,
          OR: [
            { stokAwalSelisih: { not: 0 } },
            { produksiSelisih: { not: 0 } },
            { rilisSelisih: { not: 0 } },
            { stokAkhirSelisih: { not: 0 } }
          ]
        },
        select: {
          materialId: true,
          materialName: true,
          location: true,
          stokAwalSelisih: true,
          produksiSelisih: true,
          rilisSelisih: true,
          stokAkhirSelisih: true
        },
        take: 20
      });

      materialData.forEach((material) => {
        const maxSelisih = Math.max(
          Math.abs(material.stokAwalSelisih),
          Math.abs(material.produksiSelisih),
          Math.abs(material.rilisSelisih),
          Math.abs(material.stokAkhirSelisih)
        );

        // Only notify if selisih > 100
        if (maxSelisih > 100) {
          notifications.push({
            id: `material-${material.materialId}-${material.location}`,
            type: 'material',
            title: 'Selisih Material Tinggi',
            message: `${material.materialName} (${material.location}) - Selisih maksimal: ${maxSelisih.toLocaleString('id-ID')}`,
            link: '/laporan-material',
            priority: maxSelisih > 1000 ? 'high' : 'low',
            createdAt: latestMaterialDate.importDate.toISOString()
          });
        }
      });
    }

    // 4. Check Fluktuasi — unclassified accounts and large-amount records
    const fluktuasiStats = await prisma.fluktuasiAkunPeriode.groupBy({
      by: ['accountCode'],
      _sum: { amount: true },
      _count: { accountCode: true },
      where: { klasifikasi: '' },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });

    if (fluktuasiStats.length > 0) {
      const totalUnclassified = fluktuasiStats.length;
      const maxAmount = Math.abs(fluktuasiStats[0]._sum.amount ?? 0);
      notifications.push({
        id: `fluktuasi-unclassified-${fluktuasiStats.map(r => r.accountCode).join('-')}`,
        type: 'fluktuasi',
        title: 'Akun Fluktuasi Belum Terklasifikasi',
        message: `${totalUnclassified} kode akun belum memiliki klasifikasi. Terbesar: ${fluktuasiStats[0].accountCode} (${Math.abs(fluktuasiStats[0]._sum.amount ?? 0).toLocaleString('id-ID')})`,
        link: '/fluktuasi-oi',
        priority: maxAmount > 100_000_000 ? 'high' : 'medium',
        createdAt: today.toISOString(),
      });
    }

    // Large single-period fluktuasi amounts (top 3 outliers)
    const largeFluktuasi = await prisma.fluktuasiAkunPeriode.findMany({
      where: { amount: { gt: 500_000_000 } },
      orderBy: { amount: 'desc' },
      select: { id: true, accountCode: true, periode: true, amount: true, klasifikasi: true, updatedAt: true },
      take: 3,
    });

    largeFluktuasi.forEach(r => {
      const [yr, mo] = r.periode.split('.');
      const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
      const periodeLabel = `${MONTHS_ID[parseInt(mo) - 1]} ${yr}`;
      notifications.push({
        id: `fluktuasi-large-${r.id}`,
        type: 'fluktuasi',
        title: 'Fluktuasi Nilai Besar',
        message: `Akun ${r.accountCode} periode ${periodeLabel}: Rp ${r.amount.toLocaleString('id-ID')}${r.klasifikasi ? ` (${r.klasifikasi.split(';')[0].trim()})` : ' — belum terklasifikasi'}`,
        link: '/overview-fluktuasi',
        priority: r.amount > 1_000_000_000 ? 'high' : 'medium',
        createdAt: r.updatedAt.toISOString(),
      });
    });

    // Sort by priority and date (newest first)
    const priorityOrder: { [key: string]: number } = { high: 1, medium: 2, low: 3 };
    notifications.sort((a, b) => {
      if (a.priority !== b.priority) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Limit to 20 most important notifications
    const limitedNotifications = notifications.slice(0, 20);

    return NextResponse.json({
      success: true,
      count: limitedNotifications.length,
      notifications: limitedNotifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
