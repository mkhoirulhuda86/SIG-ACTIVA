import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseExcelFile, ExcelAccrualData } from '@/app/utils/excelParser';
import { broadcast } from '@/lib/sse';
import { sendPushToAll } from '@/lib/webpush';
import { checkAccrualAlerts } from '@/lib/notificationChecker';

// Vercel function timeout: 300 detik (5 menit) untuk Pro plan, atau sesuai kebutuhan
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an Excel file (.xlsx or .xls)' },
        { status: 400 }
      );
    }

    // Parse the Excel file
    const buffer = await file.arrayBuffer();
    const { accruals, errors } = parseExcelFile(buffer);

    if (errors.length > 0) {
      console.warn('Excel parsing warnings:', errors);
    }

    if (accruals.length === 0) {
      return NextResponse.json(
        { 
          error: 'No accrual data found in the Excel file',
          warnings: errors 
        },
        { status: 400 }
      );
    }

    // Optimasi: Batch processing dengan chunk untuk menghindari timeout
    const BATCH_SIZE = 50; // Proses 50 baris sekaligus
    const results: any[] = [];
    const processedErrors: any[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    // Proses dalam batch untuk menghindari timeout
    for (let i = 0; i < accruals.length; i += BATCH_SIZE) {
      const batch = accruals.slice(i, i + BATCH_SIZE);
      
      // Process batch secara parallel (maksimal 50 concurrent operations)
      const batchPromises = batch.map(async (excelAccrual) => {
        try {
          // Match: sheet (ada noPo) = kdAkr+noPo+vendor (vendor '-' jika kosong supaya tiap baris punya record); rekap = kdAkr+klasifikasi
          const fromSheet = excelAccrual.noPo != null && excelAccrual.noPo !== '';
          const vendorForMatch = excelAccrual.vendor ?? '-';
          const existingAccrual = await prisma.accrual.findFirst({
            where: fromSheet
              ? {
                  kdAkr: excelAccrual.kdAkr,
                  noPo: excelAccrual.noPo,
                  vendor: vendorForMatch,
                }
              : {
                  kdAkr: excelAccrual.kdAkr,
                  klasifikasi: excelAccrual.klasifikasi ?? null,
                },
          });

          if (existingAccrual) {
            // Saldo awal dari import (saldo akhir/outstanding), fixed; totalAmount di-update hanya jika dari sheet (ada NILAI PO)
            const saldoAwal = excelAccrual.saldo ?? excelAccrual.totalAmount ?? 0;
            const updateData: any = {
              saldoAwal,
              ...(excelAccrual.vendor !== undefined && { vendor: excelAccrual.vendor ?? '-' }),
              ...(excelAccrual.deskripsi != null && { deskripsi: excelAccrual.deskripsi }),
              ...(excelAccrual.kdAkunBiaya != null && { kdAkunBiaya: excelAccrual.kdAkunBiaya }),
              ...(excelAccrual.klasifikasi != null && { klasifikasi: excelAccrual.klasifikasi }),
              ...(excelAccrual.noPo != null && { noPo: excelAccrual.noPo }),
              ...(excelAccrual.alokasi != null && { alokasi: excelAccrual.alokasi }),
            };
            
            // Update totalAmount hanya jika datanya dari sheet (bukan REKAP) dan ada nilai PO
            if (excelAccrual.source === 'sheet' && excelAccrual.totalAmount !== undefined) {
              updateData.totalAmount = excelAccrual.totalAmount;
            }
            
            const updatedAccrual = await prisma.accrual.update({
              where: { id: existingAccrual.id },
              data: updateData,
              include: { periodes: true },
            });

            // Periode tidak diubah pada update agar realisasi tetap; hanya saldoAwal yang di-update
            updatedCount++;
            return {
              kdAkr: excelAccrual.kdAkr,
              noPo: excelAccrual.noPo,
              vendor: excelAccrual.vendor,
              klasifikasi: excelAccrual.klasifikasi,
              action: 'updated',
              saldo: excelAccrual.saldo,
              id: existingAccrual.id,
            };
          } else {
            // Import baru: saldo awal = saldo akhir/outstanding dari file (fixed); periode dimulai Januari, total accrual awal 0
            const saldoAwal = excelAccrual.saldo ?? excelAccrual.totalAmount ?? 0;
            const tahun = new Date().getFullYear();
            const startDate = new Date(tahun, 0, 1); // 1 Januari
            const bulanNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const newAccrual = await prisma.accrual.create({
              data: {
                kdAkr: excelAccrual.kdAkr,
                kdAkunBiaya: excelAccrual.kdAkunBiaya ?? 'DEFAULT',
                vendor: excelAccrual.vendor ?? '-',
                deskripsi:
                  excelAccrual.deskripsi ??
                  `Imported from Excel - ${excelAccrual.kdAkr}${excelAccrual.klasifikasi ? ` (${excelAccrual.klasifikasi})` : ''}`,
                klasifikasi: excelAccrual.klasifikasi ?? null,
                totalAmount: excelAccrual.totalAmount ?? 0,
                saldoAwal,
                noPo: excelAccrual.noPo ?? null,
                alokasi: excelAccrual.alokasi ?? null,
                startDate,
                jumlahPeriode: 12,
                pembagianType: 'otomatis',
                periodes: {
                  create: bulanNames.map((bulan, i) => ({
                    periodeKe: i + 1,
                    bulan: `${bulan} ${tahun}`,
                    tahun,
                    amountAccrual: 0,
                  })),
                },
              },
              include: { periodes: true },
            });

            createdCount++;
            return {
              kdAkr: excelAccrual.kdAkr,
              noPo: excelAccrual.noPo,
              vendor: excelAccrual.vendor,
              klasifikasi: excelAccrual.klasifikasi,
              action: 'created',
              saldo: excelAccrual.saldo,
              id: newAccrual.id,
            };
          }
        } catch (error) {
          return {
            error: true,
            kdAkr: excelAccrual.kdAkr,
            noPo: excelAccrual.noPo,
            vendor: excelAccrual.vendor,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      });

      // Tunggu batch selesai sebelum lanjut ke batch berikutnya
      const batchResults = await Promise.all(batchPromises);
      
      // Pisahkan hasil dan error
      for (const result of batchResults) {
        if (result.error) {
          processedErrors.push({
            kdAkr: result.kdAkr,
            noPo: result.noPo,
            vendor: result.vendor,
            error: result.errorMessage,
          });
        } else {
          results.push(result);
        }
      }

      // Log progress untuk monitoring
      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(accruals.length / BATCH_SIZE)}: ${results.length} success, ${processedErrors.length} errors`);
    }

    broadcast('accrual');
    sendPushToAll({ title: 'Import Accrual Selesai', body: `${results.length} data accrual berhasil diproses`, url: '/monitoring-accrual', priority: 'medium' }).catch(() => {});
    checkAccrualAlerts().catch(() => {});
    return NextResponse.json({
      message: `Successfully processed ${results.length} baris`,
      results,
      createdCount,
      updatedCount,
      totalProcessed: results.length,
      errors: processedErrors,
      warnings: errors
    });

  } catch (error) {
    console.error('Error importing Excel file:', error);
    return NextResponse.json(
      { error: 'Failed to import Excel file', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
