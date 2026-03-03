
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // Material: pipe findFirst→findMany inside Promise.all so it runs fully parallel
    const materialPromise = prisma.materialData
      .findFirst({ select: { importDate: true }, orderBy: { importDate: 'desc' } })
      .then(latest =>
        latest
          ? prisma.materialData.findMany({
              select: {
                location: true,
                materialId: true,
                stokAwalSelisih: true,
                produksiSelisih: true,
                rilisSelisih: true,
                stokAkhirSelisih: true,
              },
              where: { importDate: latest.importDate },
            })
          : Promise.resolve([]),
      );

    // Fluktuasi: use DB aggregations instead of loading every row
    const fluktuasiPeriodePromise = prisma.fluktuasiAkunPeriode.groupBy({
      by: ['periode'],
      _sum: { amount: true },
      orderBy: { periode: 'asc' },
    });
    const fluktuasiAggPromise = prisma.fluktuasiAkunPeriode.aggregate({
      _count: { id: true },
      _sum:   { amount: true },
    });
    // Klasifikasi still needs per-row data (multi-value split by ';')
    const fluktuasiKlasifPromise = prisma.fluktuasiAkunPeriode.findMany({
      select: { amount: true, klasifikasi: true },
    });

    // All queries fully parallel
    const [
      materialData,
      prepaidData,
      accrualData,
      fluktuasiPeriodeGroups,
      fluktuasiAgg,
      fluktuasiKlasif,
    ] = await Promise.all([
      materialPromise,
      // Prepaid - only needed fields
      prisma.prepaid.findMany({
        select: {
          namaAkun: true,
          alokasi: true,
          klasifikasi: true,
          totalAmount: true,
          remaining: true,
          periodes: { select: { isAmortized: true } },
        },
      }),
      // Accrual - only needed fields
      prisma.accrual.findMany({
        select: {
          vendor: true,
          klasifikasi: true,
          totalAmount: true,
          saldoAwal: true,
          pembagianType: true,
          periodes: {
            select: {
              bulan: true,
              tahun: true,
              amountAccrual: true,
              realisasis: { select: { amount: true } },
            },
          },
        },
      }),
      fluktuasiPeriodePromise,
      fluktuasiAggPromise,
      fluktuasiKlasifPromise,
    ]);

    // Group by location with selisih calculation
    const materialByLocation = materialData.reduce((acc: Record<string, { totalSelisih: number; countSelisih: number; countClear: number }>, item) => {
      const location = item.location || 'Unknown';
      if (!acc[location]) {
        acc[location] = { totalSelisih: 0, countSelisih: 0, countClear: 0 };
      }
      
      // Calculate total selisih from all selisih fields
      const totalItemSelisih = Math.abs(item.stokAwalSelisih || 0) + 
                                Math.abs(item.produksiSelisih || 0) + 
                                Math.abs(item.rilisSelisih || 0) + 
                                Math.abs(item.stokAkhirSelisih || 0);
      
      acc[location].totalSelisih += totalItemSelisih;
      
      if (totalItemSelisih > 0) {
        acc[location].countSelisih += 1;
      } else {
        acc[location].countClear += 1;
      }
      
      return acc;
    }, {});

    const materialSummary = Object.entries(materialByLocation)
      .map(([location, data]) => ({
        label: location,
        value: data.totalSelisih,
        countSelisih: data.countSelisih,
        countClear: data.countClear,
        amount: data.totalSelisih,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); // Top 5 by selisih

    // Material by ID prefix (first 2 chars as type)
    const materialByType = materialData.reduce((acc: Record<string, number>, item) => {
      const type = item.materialId.substring(0, 2) || 'XX';
      if (!acc[type]) {
        acc[type] = 0;
      }
      acc[type] += 1;
      return acc;
    }, {});

    const materialTypeData = Object.entries(materialByType)
      .map(([type, count]) => ({
        label: `Tipe ${type}`,
        value: count,
      }))
      .slice(0, 5); // Top 5 only

    // Calculate prepaid status (based on remaining amount)
    const prepaidStatus = {
      active: prepaidData.filter((p) => p.remaining > 0).length,
      cleared: prepaidData.filter((p) => p.remaining === 0).length,
      pending: prepaidData.filter((p) => p.periodes.some(period => !period.isAmortized)).length,
    };

    const totalPrepaid = prepaidData.reduce((sum: number, item) => sum + (item.totalAmount || 0), 0);
    const totalRemaining = prepaidData.reduce((sum: number, item) => sum + (item.remaining || 0), 0);
    const totalCleared = totalPrepaid - totalRemaining;

    // Top Prepaid by Amount (instead of by vendor)
    const topPrepaidByAmount = prepaidData
      .map((item) => ({
        label: `${item.namaAkun} - ${item.alokasi}`,
        value: item.totalAmount,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Prepaid by Klasifikasi
    const prepaidByKlasifikasi = prepaidData.reduce((acc: Record<string, number>, item) => {
      const klasifikasi = item.klasifikasi || 'Tidak ada klasifikasi';
      if (!acc[klasifikasi]) {
        acc[klasifikasi] = 0;
      }
      acc[klasifikasi] += item.totalAmount || 0;
      return acc;
    }, {});

    const topPrepaidByKlasifikasi = Object.entries(prepaidByKlasifikasi)
      .map(([klasifikasi, amount]) => ({
        label: klasifikasi,
        value: amount as number,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Calculate accrual totals and status: saldo = saldo awal + total accrual - realisasi
    const bulanMap: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
      'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11,
    };

    // Mirror calculateAccrualAmount: for non-manual only count past-due OR effective-realisasi periods
    const calcAccrualAmount = (accrual: any): number => {
      if (!accrual.periodes || accrual.periodes.length === 0) return 0;
      if (accrual.pembagianType === 'manual') {
        return accrual.periodes.reduce((s: number, p: any) => s + Math.abs(p.amountAccrual || 0), 0);
      }
      const today = new Date();
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let total = 0;
      let rollover = 0;
      for (const p of accrual.periodes) {
        const [bulanName, tahunStr] = (p.bulan as string).split(' ');
        const periodeBulan = bulanMap[bulanName] ?? 0;
        const periodeTahun = parseInt(tahunStr);
        const periodeDate = new Date(periodeTahun, periodeBulan, 1);
        const realisasiRaw = p.realisasis?.reduce((s: number, r: any) => s + Math.abs(r.amount), 0) || 0;
        const totalAvailable = realisasiRaw + rollover;
        const cap = Math.abs(p.amountAccrual || 0);
        const effective = Math.min(totalAvailable, cap);
        rollover = Math.max(0, totalAvailable - cap);
        if (todayDate >= periodeDate || effective > 0) total += cap;
      }
      return total;
    };

    // Raw realisasi per accrual: plain sum of all realisasi amounts (mirrors calculateActualRealisasi)
    const calcRawRealisasi = (accrual: any): number => {
      if (!accrual.periodes || accrual.periodes.length === 0) return 0;
      return accrual.periodes.reduce((s: number, p: any) => {
        return s + (p.realisasis?.reduce((rs: number, r: any) => rs + Math.abs(r.amount), 0) || 0);
      }, 0);
    };

    const accrualWithCalculations = accrualData.map((accrual: any) => {
      const totalAccrualItem = calcAccrualAmount(accrual);
      // Use raw realisasi to match the monitoring-accrual page "Saldo" metric logic
      const totalRealized = calcRawRealisasi(accrual);
      const saldoAwal = accrual.saldoAwal != null ? Number(accrual.saldoAwal) : Math.abs(accrual.totalAmount || 0);
      const remaining = saldoAwal + totalAccrualItem - totalRealized;
      return {
        ...accrual,
        totalRealized,
        remaining,
      };
    });

    const accrualStatus = {
      active: accrualWithCalculations.filter((a: any) => a.remaining > 0).length,
      cleared: accrualWithCalculations.filter((a: any) => a.remaining === 0).length,
      pending: accrualWithCalculations.filter((a: any) => a.remaining > (a.saldoAwal ?? a.totalAmount ?? 0) * 0.5).length,
    };

    const totalAccrual = accrualWithCalculations.reduce((sum: number, item: any) => {
      return sum + calcAccrualAmount(item);
    }, 0);
    const totalRealized = accrualWithCalculations.reduce((sum: number, item: any) => sum + item.totalRealized, 0);
    const totalAccrualRemaining = accrualWithCalculations.reduce((sum: number, item: any) => sum + item.remaining, 0);

    // Accrual by Vendor (saldo per item)
    const accrualByVendor = accrualWithCalculations.reduce((acc: Record<string, number>, item: any) => {
      const vendor = item.vendor || 'Unknown';
      if (!acc[vendor]) {
        acc[vendor] = 0;
      }
      acc[vendor] += item.remaining ?? 0;
      return acc;
    }, {});

    const topAccrualVendors = Object.entries(accrualByVendor)
      .map(([vendor, amount]) => ({
        label: vendor,
        value: amount as number,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Accrual by Klasifikasi (saldo per item)
    const accrualByKlasifikasi = accrualWithCalculations.reduce((acc: Record<string, number>, item: any) => {
      const klasifikasi = item.klasifikasi || 'Tidak ada klasifikasi';
      if (!acc[klasifikasi]) {
        acc[klasifikasi] = 0;
      }
      acc[klasifikasi] += item.remaining ?? 0;
      return acc;
    }, {});

    const topAccrualByKlasifikasi = Object.entries(accrualByKlasifikasi)
      .map(([klasifikasi, amount]) => ({
        label: klasifikasi,
        value: amount as number,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // ── Fluktuasi calculations (using DB aggregations) ────────────────────
    const fluktuasiTotal = fluktuasiAgg._sum.amount ?? 0;
    const fluktuasiCount = fluktuasiAgg._count.id   ?? 0;

    // Top 5 by klasifikasi — still needs per-row split on ';'
    const fluktuasiByKlasifikasi: Record<string, number> = {};
    fluktuasiKlasif.forEach((r) => {
      const raw   = r.klasifikasi || '(Tanpa Klasifikasi)';
      const parts = raw.split(';').map((p: string) => p.trim()).filter(Boolean);
      const share = r.amount / parts.length;
      parts.forEach((k: string) => {
        fluktuasiByKlasifikasi[k] = (fluktuasiByKlasifikasi[k] ?? 0) + share;
      });
    });
    const topFluktuasiByKlasifikasi = Object.entries(fluktuasiByKlasifikasi)
      .map(([label, value]) => ({ label, value: value as number }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5);

    // Last 6 periods — already sorted + summed by DB
    const last6Periodes = fluktuasiPeriodeGroups
      .slice(-6)
      .map(g => ({ periode: g.periode, value: g._sum.amount ?? 0 }));

    // MoM change (last two periods)
    const momChange = last6Periodes.length >= 2
      ? last6Periodes[last6Periodes.length - 1].value - last6Periodes[last6Periodes.length - 2].value
      : 0;
    const momPct = last6Periodes.length >= 2 && last6Periodes[last6Periodes.length - 2].value !== 0
      ? (momChange / Math.abs(last6Periodes[last6Periodes.length - 2].value)) * 100
      : 0;

    const res = NextResponse.json({
      material: {
        summary: materialSummary,
        byType: materialTypeData,
        total: materialData.length,
      },
      prepaid: {
        status: prepaidStatus,
        financial: {
          total: totalPrepaid,
          cleared: totalCleared,
          remaining: totalRemaining,
        },
        topPrepaidByAmount,
        topByKlasifikasi: topPrepaidByKlasifikasi,
        total: prepaidData.length,
      },
      accrual: {
        status: accrualStatus,
        financial: {
          total: totalAccrual,
          realized: totalRealized,
          remaining: totalAccrualRemaining,
        },
        topVendors: topAccrualVendors,
        topByKlasifikasi: topAccrualByKlasifikasi,
        total: accrualData.length,
      },
      fluktuasi: {
        total: fluktuasiCount,
        netAmount: fluktuasiTotal,
        momChange,
        momPct,
        topByKlasifikasi: topFluktuasiByKlasifikasi,
        last6Periodes,
      },
    });
    // Cache for 90 s on CDN/proxy; serve stale for up to 3 min while revalidating
    res.headers.set('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=180');
    return res;
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil ringkasan data' },
      { status: 500 }
    );
  }
}
