import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { broadcast } from '@/lib/sse';

// Simple XML parser for SpreadsheetML format
function parseSpreadsheetML(xmlText: string): any[][] {
  const rows: any[][] = [];
  
  // Extract all Row elements using regex (simpler than full XML parser)
  // Handle both <Row>...</Row> and self-closing <Row/>
  const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(xmlText)) !== null) {
    const rowContent = rowMatch[1];
    const row: any[] = [];
    
    // Extract all Cell elements in this row
    // Handle both <Cell>...</Cell> and self-closing <Cell/>
    const cellRegex = /<Cell([^>]*)>([\s\S]*?)<\/Cell>/g;
    let cellMatch;
    let currentIndex = 0;
    
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const cellAttributes = cellMatch[1];
      const cellContent = cellMatch[2];
      
      // Check for ss:Index attribute (can be ss:Index="22" or Index="22")
      const indexMatch = cellAttributes.match(/ss:Index="(\d+)"/) || 
                         cellAttributes.match(/Index="(\d+)"/);
      if (indexMatch) {
        const targetIndex = parseInt(indexMatch[1], 10) - 1;
        while (currentIndex < targetIndex) {
          row.push('');
          currentIndex++;
        }
      }
      
      // Extract Data element value
      // Handle both <Data ss:Type="...">value</Data> and <Data>value</Data>
      const dataMatch = cellContent.match(/<Data[^>]*>([\s\S]*?)<\/Data>/);
      let value = dataMatch ? dataMatch[1].trim() : '';
      
      // Handle DateTime format (e.g., "2026-01-19T00:00:00.000")
      const dateTimeMatch = value.match(/^(\d{4}-\d{2}-\d{2})T/);
      if (dateTimeMatch) {
        value = dateTimeMatch[1];
      }
      
      // Decode XML entities if any
      value = value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      
      row.push(value);
      currentIndex++;
    }
    
    // Only add row if it has at least one cell
    if (row.length > 0) {
      rows.push(row);
    }
  }
  
  return rows;
}

// Parse Excel file (.xlsx, .xls)
function parseExcelFile(buffer: ArrayBuffer): any[][] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to 2D array, keep raw values
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1,
    raw: false, // Convert to strings for easier handling
    defval: '' // Default value for empty cells
  });
  
  return rows;
}

function bulanKeyFromDate(d: Date) {
  const bulanNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${bulanNames[d.getMonth()]} ${d.getFullYear()}`;
}

async function findAccrualAndPeriode(params: {
  poNumber: string;
  companyCode?: string;
  costCenter?: string;
  headerText?: string;
  postingDate: Date;
}): Promise<
  | { accrualId: number; accrualNoPo: string | null; periodeId: number; periodeBulan: string }
  | { error: string }
> {
  const { poNumber, companyCode, costCenter, headerText, postingDate } = params;
  const expectedBulan = bulanKeyFromDate(postingDate);
  const postingYear = postingDate.getFullYear();

  // 1) Primary match: by PO number
  if (poNumber) {
    const byPo = await prisma.accrual.findFirst({
      where: { noPo: poNumber },
      select: {
        id: true,
        noPo: true,
        periodes: {
          where: { bulan: expectedBulan, tahun: postingYear },
          select: { id: true, bulan: true },
          take: 1,
        },
      },
    });
    if (byPo?.periodes?.[0]) {
      return {
        accrualId: byPo.id,
        accrualNoPo: byPo.noPo,
        periodeId: byPo.periodes[0].id,
        periodeBulan: byPo.periodes[0].bulan,
      };
    }
    // Kalau PO ketemu tapi periode bulan tsb tidak ada, lanjut fallback (kemungkinan accrual periodenya beda range).
  }

  // 2) Fallback: match by (companyCode + costCenter + headerText + periode bulan)
  // Tujuan: jika accrual tidak punya noPo di sistem, tapi XML punya PO, tetap bisa ketemu item accrual yang tepat.
  const whereFallback: any = {
    periodes: {
      some: { bulan: expectedBulan, tahun: postingYear },
    },
  };
  if (companyCode) whereFallback.companyCode = companyCode;
  if (costCenter) whereFallback.costCenter = costCenter;
  if (headerText) whereFallback.headerText = headerText;

  const candidates = await prisma.accrual.findMany({
    where: whereFallback,
    select: {
      id: true,
      noPo: true,
      periodes: {
        where: { bulan: expectedBulan, tahun: postingYear },
        select: { id: true, bulan: true },
        take: 1,
      },
    },
    take: 5, // batasi: kita hanya butuh tahu unik / ambigu
  });

  if (candidates.length === 1 && candidates[0].periodes?.[0]) {
    return {
      accrualId: candidates[0].id,
      accrualNoPo: candidates[0].noPo,
      periodeId: candidates[0].periodes[0].id,
      periodeBulan: candidates[0].periodes[0].bulan,
    };
  }

  if (candidates.length > 1) {
    return {
      error:
        `Match ambigu (lebih dari 1 accrual) untuk periode ${expectedBulan}. ` +
        `Filter: companyCode=${companyCode || '-'}, costCenter=${costCenter || '-'}, headerText=${headerText || '-'}.`,
    };
  }

  return {
    error:
      `Accrual tidak ditemukan untuk periode ${expectedBulan}. ` +
      `Coba pastikan data accrual punya noPo atau minimal companyCode/costCenter/headerText sesuai XML.`,
  };
}

// POST - Import realisasi from XML or Excel file
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const periodeIdStr = formData.get('periodeId') as string | null;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const isXml = fileName.endsWith('.xml');
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    // Validate file type
    if (!isXml && !isExcel) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an XML or Excel file (.xml, .xlsx, .xls)' },
        { status: 400 }
      );
    }

    // If periodeId is provided, verify it exists
    let targetPeriode: any = null;
    if (periodeIdStr) {
      const periodeId = parseInt(periodeIdStr, 10);
      if (!isNaN(periodeId)) {
        targetPeriode = await prisma.accrualPeriode.findUnique({
          where: { id: periodeId },
          include: { accrual: true }
        });
        
        if (!targetPeriode) {
          return NextResponse.json(
            { error: 'Periode tidak ditemukan' },
            { status: 404 }
          );
        }
      }
    }

    let rows: any[][];

    if (isXml) {
      // Parse XML file
      const text = await file.text();
      rows = parseSpreadsheetML(text);
    } else {
      // Parse Excel file
      const buffer = await file.arrayBuffer();
      rows = parseExcelFile(buffer);
    }
    
    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'File must contain at least a header row and data rows' },
        { status: 400 }
      );
    }

    // Skip header row (index 0) and process data rows
    const dataRows = rows.slice(1);
    
    if (dataRows.length === 0) {
      return NextResponse.json(
        { error: 'No data rows found in XML file' },
        { status: 400 }
      );
    }

    // Column mapping based on XML structure:
    // Column 0: Company Code
    // Column 1: User Name
    // Column 2: Ref Document Number
    // Column 3: Purchasing Document (PO number) - untuk matching
    // Column 4: Purchase order text
    // Column 5: CO partner object name
    // Column 6: Name of offsetting account
    // Column 7: Cost element name
    // Column 8: Cost Element
    // Column 9: Value in Obj. Crcy (amount) - untuk realisasi
    // Column 10: Cost Center
    // Column 11: CO object name
    // Column 12: Document Header Text
    // Column 13: Text
    // Column 14: Partner order no.
    // Column 15: Posting Date - untuk menentukan periode
    // Column 16: Val/COArea Crcy
    // Column 17: Material
    // Column 18: Material Description
    // Column 19: Document Number
    // Column 20: Period
    // Column 21: Offsetting account type

    const results: any[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // Extract key fields
      const amountStr = row[9]?.toString().trim(); // Value in Obj. Crcy
      const postingDateStr = row[15]?.toString().trim(); // Posting Date
      const costElement = row[8]?.toString().trim(); // Cost Element (Kode Akun Biaya)
      const costCenter = row[10]?.toString().trim(); // Cost Center
      
      // Optional fields for keterangan
      const documentNumber = row[19]?.toString().trim(); // Document Number
      const headerText = row[12]?.toString().trim(); // Document Header Text
      const text = row[13]?.toString().trim(); // Text
      const material = row[17]?.toString().trim(); // Material
      const materialDesc = row[18]?.toString().trim(); // Material Description

      // Validate required fields
      if (!amountStr || !postingDateStr) {
        errors.push(`Baris ${i + 2}: Missing required fields (Amount or Posting Date)`);
        errorCount++;
        continue;
      }

      // Parse amount
      const amount = parseFloat(amountStr.replace(/,/g, ''));
      if (isNaN(amount) || amount === 0) {
        errors.push(`Baris ${i + 2}: Invalid amount value: ${amountStr}`);
        errorCount++;
        continue;
      }

      // Parse posting date
      let postingDate: Date;
      try {
        // Handle various date formats
        if (postingDateStr.includes('T')) {
          postingDate = new Date(postingDateStr);
        } else if (postingDateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          postingDate = new Date(postingDateStr + 'T00:00:00');
        } else {
          postingDate = new Date(postingDateStr);
        }
        
        if (isNaN(postingDate.getTime())) {
          throw new Error('Invalid date');
        }
      } catch (error) {
        errors.push(`Baris ${i + 2}: Invalid posting date format: ${postingDateStr}`);
        errorCount++;
        continue;
      }

      let periodeId: number;
      let accrualId: number;
      let periodeBulan: string;

      // If targetPeriode is provided, use it directly without matching
      if (targetPeriode) {
        periodeId = targetPeriode.id;
        accrualId = targetPeriode.accrual.id;
        periodeBulan = targetPeriode.bulan;
      } else {
        // Original matching logic for global import
        const poNumber = row[3]?.toString().trim(); // Purchasing Document
        const companyCode = row[0]?.toString().trim(); // Company Code
        
        if (!poNumber) {
          errors.push(`Baris ${i + 2}: Missing PO Number for global import`);
          errorCount++;
          continue;
        }

        const match = await findAccrualAndPeriode({
          poNumber,
          companyCode: companyCode || undefined,
          costCenter: costCenter || undefined,
          headerText: headerText || undefined,
          postingDate,
        });

        if ('error' in match) {
          errors.push(`Baris ${i + 2}: ${match.error}`);
          errorCount++;
          continue;
        }

        periodeId = match.periodeId;
        accrualId = match.accrualId;
        periodeBulan = match.periodeBulan;
      }

      // Build keterangan from available fields (kept for backward compat)
      const keteranganParts: string[] = [];
      if (documentNumber) keteranganParts.push(`Doc: ${documentNumber}`);
      if (material) keteranganParts.push(`Material: ${material}`);
      if (materialDesc) keteranganParts.push(`Desc: ${materialDesc}`);
      
      const keterangan = keteranganParts.length > 0 
        ? keteranganParts.join(' | ')
        : `Import dari XML - Baris ${i + 2}`;

      // Create realisasi entry
      try {
        const realisasi = await prisma.accrualRealisasi.create({
          data: {
            accrualPeriodeId: periodeId,
            tanggalRealisasi: postingDate,
            amount: amount,
            headerText: headerText || undefined,
            lineText: text || undefined,
            keterangan: keterangan,
            kdAkunBiaya: costElement || undefined,
            costCenter: costCenter || undefined,
          },
        });

        // Optional: Update PO number if not present (only for non-targetPeriode imports)
        if (!targetPeriode) {
          const poNumber = row[3]?.toString().trim();
          const accrual = await prisma.accrual.findUnique({
            where: { id: accrualId },
            select: { noPo: true }
          });
          
          if (poNumber && accrual && (!accrual.noPo || accrual.noPo.trim() === '')) {
            await prisma.accrual.update({
              where: { id: accrualId },
              data: { noPo: poNumber },
            });
          }
        }

        successCount++;
        results.push({
          row: i + 2,
          amount,
          postingDate: postingDateStr,
          periode: periodeBulan,
          realisasiId: realisasi.id,
          status: 'success',
        });
      } catch (error) {
        errors.push(`Baris ${i + 2}: Error creating realisasi - ${error instanceof Error ? error.message : 'Unknown error'}`);
        errorCount++;
      }
    }

    broadcast('accrual');
    return NextResponse.json({
      message: `Import selesai: ${successCount} berhasil, ${errorCount} error`,
      successCount,
      errorCount,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error importing realisasi from XML:', error);
    return NextResponse.json(
      { 
        error: 'Failed to import realisasi from XML',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
