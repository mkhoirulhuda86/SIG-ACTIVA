import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';
import { checkMaterialAlerts } from '@/lib/notificationChecker';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';

// Helper to transform raw/prisma rows into MaterialData API shape
function transformRows(data: any[]) {
  return data.map((item: any) => ({
    materialId: item.materialId,
    materialName: item.materialName,
    location: item.location,
    stokAwal: {
      opr: item.stokAwalOpr,
      sap: item.stokAwalSap,
      selisih: item.stokAwalSelisih,
      total: item.stokAwalTotal,
    },
    produksi: {
      opr: item.produksiOpr,
      sap: item.produksiSap,
      selisih: item.produksiSelisih,
      total: item.produksiTotal,
    },
    rilis: {
      opr: item.rilisOpr,
      sap: item.rilisSap,
      selisih: item.rilisSelisih,
      total: item.rilisTotal,
    },
    stokAkhir: {
      opr: item.stokAkhirOpr,
      sap: item.stokAkhirSap,
      selisih: item.stokAkhirSelisih,
      total: item.stokAkhirTotal,
    },
    blank: item.blank ?? 0,
    blankTotal: item.blankTotal ?? 0,
    grandTotal: item.grandTotal ?? 0,
  }));
}

// Single raw-SQL query: get all rows for the latest importDate in one DB round-trip
async function fetchLatestData(targetDate?: Date): Promise<any[]> {
  if (targetDate) {
    return prisma.materialData.findMany({
      where: { importDate: targetDate },
      select: {
        materialId: true, materialName: true, location: true,
        stokAwalOpr: true, stokAwalSap: true, stokAwalSelisih: true, stokAwalTotal: true,
        produksiOpr: true, produksiSap: true, produksiSelisih: true, produksiTotal: true,
        rilisOpr: true, rilisSap: true, rilisSelisih: true, rilisTotal: true,
        stokAkhirOpr: true, stokAkhirSap: true, stokAkhirSelisih: true, stokAkhirTotal: true,
        blank: true, blankTotal: true, grandTotal: true,
      },
      orderBy: [{ materialId: 'asc' }, { location: 'asc' }],
      take: 5000,
    });
  }
  // No target date – use subquery to get latest in a single DB round-trip
  return prisma.$queryRaw<any[]>`
    SELECT "materialId", "materialName", location,
           "stokAwalOpr", "stokAwalSap", "stokAwalSelisih", "stokAwalTotal",
           "produksiOpr", "produksiSap", "produksiSelisih", "produksiTotal",
           "rilisOpr", "rilisSap", "rilisSelisih", "rilisTotal",
           "stokAkhirOpr", "stokAkhirSap", "stokAkhirSelisih", "stokAkhirTotal",
           blank, "blankTotal", "grandTotal"
    FROM material_data
    WHERE "importDate" = (SELECT MAX("importDate") FROM material_data)
    ORDER BY "materialId" ASC, location ASC
    LIMIT 5000
  `;
}

// GET - Fetch all material data or get list of import dates
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const importDate = searchParams.get('importDate');

    // Combined init: return history + latest data in ONE request (eliminates one HTTP round-trip)
    if (action === 'init') {
      const [historyRows, rawData] = await Promise.all([
        prisma.materialData.findMany({
          select: { importDate: true },
          distinct: ['importDate'],
          orderBy: { importDate: 'desc' },
          take: 2,
        }),
        fetchLatestData(),
      ]);
      const history = historyRows
        .map((d: any) => d.importDate.toISOString())
        .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime());
      return NextResponse.json(
        { history, data: transformRows(rawData) },
        { headers: { 'Cache-Control': 'private, no-cache' } }
      );
    }

    // Get list of unique import dates (last 2)
    if (action === 'history') {
      const dates = await prisma.materialData.findMany({
        select: { importDate: true },
        distinct: ['importDate'],
        orderBy: { importDate: 'desc' },
        take: 2,
      });
      return NextResponse.json(dates.map((d: any) => d.importDate));
    }

    // Get data for specific import date (default to latest)
    const targetDate = importDate ? new Date(importDate) : undefined;
    const data = await fetchLatestData(targetDate);

    if (!data.length && !importDate) {
      return NextResponse.json([]);
    }

    return NextResponse.json(transformRows(data));
  } catch (error) {
    console.error('Error fetching material data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch material data' },
      { status: 500 }
    );
  }
}

// POST - Save material data (keep only last 2 imports by date)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const data = await request.json();
    
    // Use current timestamp truncated to minute
    const now = new Date();
    const importDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

    // Check if data with this exact importDate already exists
    const existingData = await prisma.materialData.findFirst({
      where: {
        importDate: importDate
      }
    });

    // If data already exists for this minute, delete it first to avoid duplicates
    if (existingData) {
      await prisma.materialData.deleteMany({
        where: {
          importDate: importDate
        }
      });
      console.log('Deleted existing data with same timestamp to avoid duplicates');
    }

    // Insert new data
    const records = data.map((item: any) => ({
      materialId: item.materialId,
      materialName: item.materialName,
      location: item.location,
      stokAwalOpr: item.stokAwal?.opr || 0,
      stokAwalSap: item.stokAwal?.sap || 0,
      stokAwalSelisih: item.stokAwal?.selisih || 0,
      stokAwalTotal: item.stokAwal?.total || 0,
      produksiOpr: item.produksi?.opr || 0,
      produksiSap: item.produksi?.sap || 0,
      produksiSelisih: item.produksi?.selisih || 0,
      produksiTotal: item.produksi?.total || 0,
      rilisOpr: item.rilis?.opr || 0,
      rilisSap: item.rilis?.sap || 0,
      rilisSelisih: item.rilis?.selisih || 0,
      rilisTotal: item.rilis?.total || 0,
      stokAkhirOpr: item.stokAkhir?.opr || 0,
      stokAkhirSap: item.stokAkhir?.sap || 0,
      stokAkhirSelisih: item.stokAkhir?.selisih || 0,
      stokAkhirTotal: item.stokAkhir?.total || 0,
      blank: item.blank || 0,
      blankTotal: item.blankTotal || 0,
      grandTotal: item.grandTotal || 0,
      importDate: importDate,
    }));

    await prisma.materialData.createMany({
      data: records,
    });

    // Clean up: Get all unique dates and delete the oldest ones
    const allUniqueDates = await prisma.materialData.groupBy({
      by: ['importDate'],
      _count: true,
      orderBy: {
        importDate: 'desc'
      }
    });

    console.log('All dates after insert:', allUniqueDates.map((d: any) => d.importDate));

    // If more than 2 unique dates, delete the old ones
    if (allUniqueDates.length > 2) {
      const datesToDelete = allUniqueDates.slice(2); // Get everything after index 2
      
      for (const dateGroup of datesToDelete) {
        await prisma.materialData.deleteMany({
          where: {
            importDate: dateGroup.importDate
          }
        });
        console.log('Deleted old import:', dateGroup.importDate);
      }
    }

    console.log('Data saved. Import date:', importDate);

    broadcast('material');
    sendPushToAll({ title: 'Import Material Selesai', body: `${records.length} data material berhasil diimport`, url: '/laporan-material', priority: 'medium' }).catch(() => {});
    checkMaterialAlerts().catch(() => {});
    return NextResponse.json({ 
      success: true, 
      count: records.length,
      importDate: importDate.toISOString()
    });
  } catch (error) {
    console.error('Error saving material data:', error);
    return NextResponse.json(
      { error: 'Failed to save material data' },
      { status: 500 }
    );
  }
}

// DELETE - Clear all material data or specific import date
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const importDate = searchParams.get('importDate');

    if (importDate) {
      // Delete specific import date
      await prisma.materialData.deleteMany({
        where: {
          importDate: new Date(importDate)
        }
      });
      broadcast('material');
      sendPushToAll({ title: 'Data Material Dihapus', body: `Data material untuk ${importDate} berhasil dihapus`, url: '/laporan-material', priority: 'low' }).catch(() => {});
      return NextResponse.json({ success: true, message: `Deleted data for ${importDate}` });
    } else {
      // Delete all
      await prisma.materialData.deleteMany({});
      broadcast('material');
      sendPushToAll({ title: 'Semua Data Material Dihapus', body: 'Seluruh data material berhasil dihapus', url: '/laporan-material', priority: 'medium' }).catch(() => {});
      return NextResponse.json({ success: true, message: 'Deleted all data' });
    }
  } catch (error) {
    console.error('Error deleting material data:', error);
    return NextResponse.json(
      { error: 'Failed to delete material data' },
      { status: 500 }
    );
  }
}
