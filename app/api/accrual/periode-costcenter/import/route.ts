import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

// POST - Import rincian accrual per cost center dari Excel atau XML SAP
// Format Excel sederhana (header baris 1):
//   Kolom A: Amount  |  B: Cost Center  |  C: Kode Akun Biaya  |  D: Header Text  |  E: Line Text
//
// Format XML SAP (sama dengan import realisasi):
//   Kolom 9 : Amount  |  10: Cost Center  |  8: Cost Element (Kode Akun Biaya)
//   Kolom 12: Header Text (bktxt)  |  13: Line Text (sgtxt)  |  19: Document Number
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const periodeIdStr = formData.get('periodeId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!periodeIdStr) {
      return NextResponse.json({ error: 'Missing periodeId' }, { status: 400 });
    }

    const periodeId = parseInt(periodeIdStr, 10);
    if (isNaN(periodeId)) {
      return NextResponse.json({ error: 'Invalid periodeId' }, { status: 400 });
    }

    const periode = await prisma.accrualPeriode.findUnique({ where: { id: periodeId } });
    if (!periode) {
      return NextResponse.json({ error: 'Periode tidak ditemukan' }, { status: 404 });
    }

    const fileName = file.name.toLowerCase();
    const isXml = fileName.endsWith('.xml');
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (!isXml && !isExcel) {
      return NextResponse.json(
        { error: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .xml' },
        { status: 400 }
      );
    }

    let rows: any[][];

    if (isXml) {
      const text = await file.text();
      rows = parseSpreadsheetML(text);
    } else {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as any[][];
    }

    if (rows.length < 2) {
      return NextResponse.json({ error: 'File harus memiliki minimal satu baris header dan satu baris data' }, { status: 400 });
    }

    const dataRows = rows.slice(1);
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const created: any[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      let amountStr: string;
      let costCenter: string;
      let kdAkunBiaya: string;
      let headerText: string;
      let lineText: string;
      let keterangan: string;

      if (isXml) {
        // SAP XML format — same column mapping as realisasi import
        amountStr   = row[9]?.toString().trim()  ?? '';
        costCenter  = row[10]?.toString().trim() ?? '';
        kdAkunBiaya = row[8]?.toString().trim()  ?? '';
        headerText  = row[12]?.toString().trim() ?? '';
        lineText    = row[13]?.toString().trim() ?? '';
        const docNum = row[19]?.toString().trim() ?? '';
        keterangan  = docNum ? `Doc: ${docNum}` : '';
      } else {
        // Simple Excel: A=Amount, B=Cost Center, C=Kode Akun Biaya, D=Header Text, E=Line Text
        amountStr   = row[0]?.toString().trim() ?? '';
        costCenter  = row[1]?.toString().trim() ?? '';
        kdAkunBiaya = row[2]?.toString().trim() ?? '';
        headerText  = row[3]?.toString().trim() ?? '';
        lineText    = row[4]?.toString().trim() ?? '';
        keterangan  = '';
      }

      if (!amountStr) {
        // Skip kosong tanpa error
        continue;
      }

      const amount = parseFloat(amountStr.replace(/,/g, ''));
      if (isNaN(amount) || amount === 0) {
        errors.push(`Baris ${i + 2}: Amount tidak valid (${amountStr})`);
        errorCount++;
        continue;
      }

      try {
        const entry = await prisma.accrualPeriodeCostCenter.create({
          data: {
            accrualPeriodeId: periodeId,
            costCenter: costCenter || null,
            kdAkunBiaya: kdAkunBiaya || null,
            amount,
            headerText: headerText || null,
            lineText: lineText || null,
            keterangan: keterangan || null,
          },
        });
        created.push(entry.id);
        successCount++;
      } catch (err) {
        errors.push(`Baris ${i + 2}: Gagal menyimpan - ${err instanceof Error ? err.message : 'Unknown error'}`);
        errorCount++;
      }
    }

    // Recalculate amountAccrual = sum semua entries untuk periode ini
    if (successCount > 0) {
      const agg = await prisma.accrualPeriodeCostCenter.aggregate({
        where: { accrualPeriodeId: periodeId },
        _sum: { amount: true },
      });
      await prisma.accrualPeriode.update({
        where: { id: periodeId },
        data: { amountAccrual: agg._sum.amount ?? 0 },
      });
    }

    return NextResponse.json({
      message: `Import selesai: ${successCount} berhasil, ${errorCount} error`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error importing cost center entries:', error);
    return NextResponse.json(
      { error: 'Gagal import file', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ── XML parser (SpreadsheetML) — same as realisasi import ──────────────────
function parseSpreadsheetML(xmlText: string): any[][] {
  const rows: any[][] = [];
  const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xmlText)) !== null) {
    const rowContent = rowMatch[1];
    const row: any[] = [];
    const cellRegex = /<Cell([^>]*)>([\s\S]*?)<\/Cell>/g;
    let cellMatch;
    let currentIndex = 0;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const cellAttributes = cellMatch[1];
      const cellContent = cellMatch[2];
      const indexMatch = cellAttributes.match(/ss:Index="(\d+)"/) || cellAttributes.match(/Index="(\d+)"/);
      if (indexMatch) {
        const targetIndex = parseInt(indexMatch[1], 10) - 1;
        while (currentIndex < targetIndex) { row.push(''); currentIndex++; }
      }
      const dataMatch = cellContent.match(/<Data[^>]*>([\s\S]*?)<\/Data>/);
      let value = dataMatch ? dataMatch[1].trim() : '';
      const dtMatch = value.match(/^(\d{4}-\d{2}-\d{2})T/);
      if (dtMatch) value = dtMatch[1];
      value = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      row.push(value);
      currentIndex++;
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}
