import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

// POST - Import realisasi from XML file
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
    if (!file.name.toLowerCase().endsWith('.xml')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an XML file (.xml)' },
        { status: 400 }
      );
    }

    // Parse XML file
    const text = await file.text();
    
    // Parse rows from XML (Excel SpreadsheetML format)
    const rows = parseSpreadsheetML(text);
    
    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'XML file must contain at least a header row and data rows' },
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
      const poNumber = row[3]?.toString().trim(); // Purchasing Document
      const amountStr = row[9]?.toString().trim(); // Value in Obj. Crcy
      const postingDateStr = row[15]?.toString().trim(); // Posting Date
      const documentNumber = row[19]?.toString().trim(); // Document Number
      const headerText = row[12]?.toString().trim(); // Document Header Text
      const text = row[13]?.toString().trim(); // Text
      const material = row[17]?.toString().trim(); // Material
      const materialDesc = row[18]?.toString().trim(); // Material Description
      const companyCode = row[0]?.toString().trim(); // Company Code
      const costCenter = row[10]?.toString().trim(); // Cost Center

      // Validate required fields
      if (!poNumber || !amountStr || !postingDateStr) {
        errors.push(`Baris ${i + 2}: Missing required fields (PO Number, Amount, or Posting Date)`);
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

      // Build keterangan from available fields
      const keteranganParts: string[] = [];
      if (documentNumber) keteranganParts.push(`Doc: ${documentNumber}`);
      if (headerText) keteranganParts.push(`Header: ${headerText}`);
      if (text) keteranganParts.push(`Text: ${text}`);
      if (material) keteranganParts.push(`Material: ${material}`);
      if (materialDesc) keteranganParts.push(`Desc: ${materialDesc}`);
      
      const keterangan = keteranganParts.length > 0 
        ? keteranganParts.join(' | ')
        : `Import dari XML - Baris ${i + 2}`;

      // Extract Cost Element for kdAkunBiaya
      const costElement = row[8]?.toString().trim(); // Cost Element

      // Create realisasi entry
      try {
        const realisasi = await prisma.accrualRealisasi.create({
          data: {
            accrualPeriodeId: match.periodeId,
            tanggalRealisasi: postingDate,
            amount: amount,
            keterangan: keterangan,
            kdAkunBiaya: costElement || undefined,
            costCenter: costCenter || undefined,
          },
        });

        // Optional: jika accrual belum punya noPo, tapi XML punya PO dan match fallback sukses unik, kita isi noPo supaya berikutnya makin akurat.
        if (poNumber && (!match.accrualNoPo || match.accrualNoPo.trim() === '')) {
          await prisma.accrual.update({
            where: { id: match.accrualId },
            data: { noPo: poNumber },
          });
        }

        successCount++;
        results.push({
          row: i + 2,
          poNumber,
          amount,
          postingDate: postingDateStr,
          periode: match.periodeBulan,
          realisasiId: realisasi.id,
          status: 'success',
        });
      } catch (error) {
        errors.push(`Baris ${i + 2}: Error creating realisasi - ${error instanceof Error ? error.message : 'Unknown error'}`);
        errorCount++;
      }
    }

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
