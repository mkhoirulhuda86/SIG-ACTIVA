import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Format date as YYYY-MM-DD
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format number to 2 decimal places
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// GET - Download jurnal SAP format
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Get filter parameters
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const periode = searchParams.get('periode'); // e.g., "Jan 2026"
    const costCenter = searchParams.get('costCenter');
    const format = searchParams.get('format') || 'tsv'; // 'tsv' or 'csv'
    const detail = searchParams.get('detail') === 'true'; // true for grouped format

    // Build query filter
    const filter: any = {};
    
    if (startDate) {
      filter.tanggalRealisasi = {
        ...filter.tanggalRealisasi,
        gte: new Date(startDate),
      };
    }
    
    if (endDate) {
      filter.tanggalRealisasi = {
        ...filter.tanggalRealisasi,
        lte: new Date(endDate),
      };
    }
    
    if (costCenter) {
      filter.costCenter = costCenter;
    }

    // If periode filter is specified, we need to add it to the main filter
    if (periode) {
      filter.accrualPeriode = {
        bulan: periode,
      };
    }

    // Query realisasi with all related data
    const realisasiData = await prisma.accrualRealisasi.findMany({
      where: filter,
      include: {
        accrualPeriode: {
          include: {
            accrual: {
              select: {
                companyCode: true,
                kdAkunBiaya: true,
                headerText: true,
                costCenter: true,
                vendor: true,
                deskripsi: true,
                noPo: true,
              },
            },
          },
        },
      },
      orderBy: [
        { tanggalRealisasi: 'asc' },
        { id: 'asc' },
      ],
    });

    if (realisasiData.length === 0) {
      return NextResponse.json(
        { error: 'No data found for the specified filters' },
        { status: 404 }
      );
    }

    // If detail format is requested, generate grouped format
    if (detail) {
      // Group by Kode Akun (G/L Account)
      const groupedByGL = new Map<string, any[]>();
      
      realisasiData.forEach((realisasi) => {
        const accrual = realisasi.accrualPeriode.accrual;
        const glAccount = realisasi.kdAkunBiaya || accrual.kdAkunBiaya || 'N/A';
        
        if (!groupedByGL.has(glAccount)) {
          groupedByGL.set(glAccount, []);
        }
        
        groupedByGL.get(glAccount)!.push({
          ...realisasi,
          accrual,
        });
      });

      // Build detailed report
      const lines: string[] = [];
      const delimiter = format === 'csv' ? ',' : '\t';
      
      lines.push('='.repeat(80));
      lines.push('JURNAL REALISASI ACCRUAL - DETAIL PER KODE AKUN');
      if (periode) lines.push(`Periode: ${periode}`);
      if (startDate || endDate) {
        lines.push(`Tanggal: ${startDate || 'N/A'} s/d ${endDate || 'N/A'}`);
      }
      lines.push(`Digenerate: ${new Date().toLocaleString('id-ID')}`);
      lines.push('='.repeat(80));
      lines.push('');

      let grandTotal = 0;

      // Process each GL Account group
      for (const [glAccount, items] of Array.from(groupedByGL.entries()).sort()) {
        const firstItem = items[0];
        const accrual = firstItem.accrual;
        
        lines.push('');
        lines.push(`G/L Account: ${glAccount}`);
        lines.push(`PO Number: ${accrual.noPo || 'N/A'} | Vendor: ${accrual.vendor || 'N/A'}`);
        lines.push(`Description: ${accrual.deskripsi || accrual.headerText || 'N/A'}`);
        lines.push('-'.repeat(80));
        
        // Header for details
        if (format === 'csv') {
          lines.push(['Tanggal', 'Cost Center', 'Amount', 'Keterangan'].join(delimiter));
        } else {
          lines.push('Tanggal          Cost Center      Amount              Keterangan');
        }
        lines.push('-'.repeat(80));

        let subtotal = 0;

        // List all transactions for this GL Account
        items.forEach((item) => {
          const date = formatDate(item.tanggalRealisasi);
          const cc = item.costCenter || item.accrual.costCenter || '-';
          const amount = item.amount;
          const keterangan = (item.keterangan || '').substring(0, 30);
          
          subtotal += amount;

          if (format === 'csv') {
            lines.push([date, cc, formatAmount(amount), keterangan].join(delimiter));
          } else {
            const amountStr = formatAmount(amount).padStart(15);
            lines.push(`${date}     ${cc.padEnd(15)} ${amountStr}     ${keterangan}`);
          }
        });

        grandTotal += subtotal;

        // Subtotal for this GL Account
        lines.push('-'.repeat(80));
        if (format === 'csv') {
          lines.push(['', '', formatAmount(subtotal), `Subtotal G/L ${glAccount}`].join(delimiter));
        } else {
          lines.push(`${''.padEnd(35)} ${formatAmount(subtotal).padStart(15)}     Subtotal G/L ${glAccount}`);
        }
        lines.push('='.repeat(80));
      }

      // Grand Total
      lines.push('');
      lines.push('');
      if (format === 'csv') {
        lines.push(['', '', formatAmount(grandTotal), 'GRAND TOTAL'].join(delimiter));
      } else {
        lines.push(`${''.padEnd(35)} ${formatAmount(grandTotal).padStart(15)}     GRAND TOTAL`);
      }
      lines.push('='.repeat(80));

      const fileContent = lines.join('\n');
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `jurnal_detail_${timestamp}.txt`;

      return new NextResponse(fileContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default flat format (existing logic)
    const headers = [
      'Doc. Date',
      'Pstng Date',
      'Reference',
      'Doc.Hdr Text',
      'CoCd',
      'G/L',
      'Costcenter',
      'Amount LC',
      'Crcy',
      'Text',
      'PO Number',
      'Vendor',
      'Periode',
    ];

    // Build data rows
    const rows = realisasiData.map((realisasi) => {
      const accrual = realisasi.accrualPeriode.accrual;
      const postingDate = formatDate(realisasi.tanggalRealisasi);
      
      return [
        postingDate, // Doc. Date
        postingDate, // Pstng Date (sama dengan doc date)
        `ACCR-${realisasi.id}`, // Reference (unique identifier)
        accrual.headerText || accrual.deskripsi || '', // Doc.Hdr Text
        accrual.companyCode || '', // CoCd (Company Code)
        realisasi.kdAkunBiaya || accrual.kdAkunBiaya || '', // G/L (Cost Element)
        realisasi.costCenter || accrual.costCenter || '', // Costcenter
        formatAmount(realisasi.amount), // Amount LC
        'IDR', // Crcy (Currency - default IDR)
        realisasi.keterangan || '', // Text
        accrual.noPo || '', // PO Number
        accrual.vendor || '', // Vendor
        realisasi.accrualPeriode.bulan, // Periode
      ];
    });

    // Determine delimiter
    const delimiter = format === 'csv' ? ',' : '\t';
    const fileExtension = format === 'csv' ? 'csv' : 'txt';
    const mimeType = format === 'csv' 
      ? 'text/csv' 
      : 'text/tab-separated-values';

    // Build file content
    const headerLine = headers.join(delimiter);
    const dataLines = rows.map(row => {
      // For CSV, wrap fields containing comma/quotes in quotes
      if (format === 'csv') {
        return row.map(field => {
          const str = String(field);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(delimiter);
      }
      // For TSV, just join with tab
      return row.join(delimiter);
    });

    const fileContent = [headerLine, ...dataLines].join('\n');

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `jurnal_realisasi_${timestamp}.${fileExtension}`;

    // Return file as download
    return new NextResponse(fileContent, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (error) {
    console.error('Error downloading jurnal:', error);
    return NextResponse.json(
      { 
        error: 'Failed to download jurnal',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
