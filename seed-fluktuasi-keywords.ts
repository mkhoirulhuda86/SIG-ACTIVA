import { prisma } from './lib/prisma';

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

async function seedKeywords() {
  console.log('🌱 Seeding fluktuasi keywords...');

  try {
    // Hapus semua keywords lama (optional)
    // await prisma.fluktuasiKeyword.deleteMany({});
    // console.log('✓ Cleared existing keywords');

    // Insert keywords
    let inserted = 0;
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
        console.log(`✓ Added: ${kw.keyword} (${kw.type})`);
      } else {
        console.log(`⊘ Skipped (exists): ${kw.keyword} (${kw.type})`);
      }
    }

    console.log(`\n✅ Seeding completed! ${inserted} keywords added.`);
    console.log(`Total keywords in database: ${await prisma.fluktuasiKeyword.count()}`);
  } catch (error) {
    console.error('❌ Error seeding keywords:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedKeywords();
