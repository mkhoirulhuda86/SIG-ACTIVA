import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const exampleKeywords = [
  // Klasifikasi keywords
  { keyword: 'Sindikasi SLL', type: 'klasifikasi', result: 'Sindikasi SLL', priority: 10 },
  { keyword: 'KI Maybank Syariah', type: 'klasifikasi', result: 'KI Maybank Syariah', priority: 10 },
  { keyword: 'KI BSI', type: 'klasifikasi', result: 'KI BSI', priority: 10 },
  { keyword: 'Accrue', type: 'klasifikasi', result: 'Beban Akrual', priority: 8 },
  { keyword: 'Akru', type: 'klasifikasi', result: 'Beban Akrual', priority: 8 },
  { keyword: 'Amortisasi', type: 'klasifikasi', result: 'Beban Amortisasi', priority: 8 },
  { keyword: 'Bunga', type: 'klasifikasi', result: 'Beban Bunga', priority: 7 },
  { keyword: 'Interest', type: 'klasifikasi', result: 'Beban Bunga', priority: 7 },
  { keyword: 'Listrik', type: 'klasifikasi', result: 'Beban Listrik', priority: 6 },
  { keyword: 'Air', type: 'klasifikasi', result: 'Beban Air', priority: 6 },
  { keyword: 'Asuransi', type: 'klasifikasi', result: 'Beban Asuransi', priority: 6 },
  { keyword: 'Sewa', type: 'klasifikasi', result: 'Beban Sewa', priority: 6 },
  { keyword: 'Gaji', type: 'klasifikasi', result: 'Beban Gaji', priority: 6 },
  
  // Remark keywords
  { keyword: 'Sindikasi SLL', type: 'remark', result: 'Sindikasi SLL', priority: 10 },
  { keyword: 'KI Maybank Syariah', type: 'remark', result: 'KI Maybank Syariah', priority: 10 },
  { keyword: 'KI BSI', type: 'remark', result: 'KI BSI', priority: 10 },
  { keyword: 'Bank', type: 'remark', result: 'Transaksi Bank', priority: 5 },
  { keyword: 'Vendor', type: 'remark', result: 'Pembayaran Vendor', priority: 5 },
  { keyword: 'Supplier', type: 'remark', result: 'Pembayaran Supplier', priority: 5 },
  { keyword: 'Pembayaran', type: 'remark', result: 'Pembayaran', priority: 4 },
  { keyword: 'Invoice', type: 'remark', result: 'Faktur', priority: 4 },
];

// POST: Seed example keywords
export async function POST(req: NextRequest) {
  try {
    let inserted = 0;
    let skipped = 0;

    for (const kw of exampleKeywords) {
      // Check if keyword already exists
      const existing = await prisma.fluktuasiKeyword.findFirst({
        where: {
          keyword: kw.keyword,
          type: kw.type,
        },
      });

      if (!existing) {
        await prisma.fluktuasiKeyword.create({
          data: kw,
        });
        inserted++;
      } else {
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Seed completed! ${inserted} keywords added, ${skipped} skipped (already exists)`,
      inserted,
      skipped,
      total: exampleKeywords.length,
    });
  } catch (error) {
    console.error('Error seeding keywords:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal seed keywords' },
      { status: 500 }
    );
  }
}
