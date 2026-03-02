
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // Parallel fetching for better performance
    const [materialData, prepaidData, accrualData, fluktuasiData] = await Promise.all([
      // Material Data Summary - Only fetch needed fields
      prisma.materialData.findMany({
        select: {
          location: true,
          grandTotal: true,
          materialId: true,
          stokAwalSelisih: true,
          produksiSelisih: true,
          rilisSelisih: true,
          stokAkhirSelisih: true,
        },
        take: 1000, // Limit for performance
      }),
      
      // Prepaid Summary - Only fetch needed fields
      prisma.prepaid.findMany({
        select: {
          vendor: true,
          namaAkun: true,
          alokasi: true,
          klasifikasi: true,
          totalAmount: true,
          remaining: true,
          periodes: {
            select: {
              isAmortized: true,
            },
          },
        },
      }),
      
      // Accrual Summary - Only fetch needed fields
      prisma.accrual.findMany({
        select: {
          vendor: true,
          klasifikasi: true,
          totalAmount: true,
          saldoAwal: true,
          periodes: {
            select: {
              amountAccrual: true,
              realisasis: {
                select: {
                  amount: true,
                },
              },
            },
          },
        },
      }),

      // Fluktuasi Summary
      prisma.fluktuasiAkunPeriode.findMany({
        select: {
          accountCode: true,
          periode: true,
          amount: true,
          klasifikasi: true,
        },
      }),
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
    const accrualWithCalculations = accrualData.map((accrual: any) => {
      const totalAccrualItem = accrual.periodes?.reduce((sum: number, p: any) => sum + Math.abs(p.amountAccrual || 0), 0) || 0;
      const totalRealized = accrual.periodes.reduce((sum: number, periode: any) => {
        return sum + periode.realisasis.reduce((rSum: number, realisasi: any) => rSum + Math.abs(realisasi.amount), 0);
      }, 0);
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

    const totalAccrual = accrualData.reduce((sum: number, item: any) => {
      return sum + (item.periodes?.reduce((s: number, p: any) => s + Math.abs(p.amountAccrual || 0), 0) || 0);
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

    // ── Fluktuasi calculations ──────────────────────────────────────────────
    const fluktuasiTotal = fluktuasiData.reduce((s: number, r: any) => s + r.amount, 0);

    // Top 5 by klasifikasi (absolute amount)
    const fluktuasiByKlasifikasi = fluktuasiData.reduce((acc: Record<string, number>, r: any) => {
      const k = r.klasifikasi || 'Tidak ada klasifikasi';
      acc[k] = (acc[k] ?? 0) + r.amount;
      return acc;
    }, {});
    const topFluktuasiByKlasifikasi = Object.entries(fluktuasiByKlasifikasi)
      .map(([label, value]) => ({ label, value: value as number }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5);

    // Last 6 periods sorted
    const fluktuasiByPeriode = fluktuasiData.reduce((acc: Record<string, number>, r: any) => {
      acc[r.periode] = (acc[r.periode] ?? 0) + r.amount;
      return acc;
    }, {});
    const last6Periodes = Object.entries(fluktuasiByPeriode)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([periode, value]) => ({ periode, value: value as number }));

    // MoM change (last two periods)
    const momChange = last6Periodes.length >= 2
      ? last6Periodes[last6Periodes.length - 1].value - last6Periodes[last6Periodes.length - 2].value
      : 0;
    const momPct = last6Periodes.length >= 2 && last6Periodes[last6Periodes.length - 2].value !== 0
      ? (momChange / Math.abs(last6Periodes[last6Periodes.length - 2].value)) * 100
      : 0;

    return NextResponse.json({
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
        total: fluktuasiData.length,
        netAmount: fluktuasiTotal,
        momChange,
        momPct,
        topByKlasifikasi: topFluktuasiByKlasifikasi,
        last6Periodes,
      },
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil ringkasan data' },
      { status: 500 }
    );
  }
}
