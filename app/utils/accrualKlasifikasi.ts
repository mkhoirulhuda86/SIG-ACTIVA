/**
 * Mapping kode akun accrual ke daftar klasifikasi (sama dengan form tambah data).
 * Digunakan untuk: form accrual, import Excel (normalisasi keterangan sheet REKAP).
 */
export const KODE_AKUN_KLASIFIKASI: Record<string, string[]> = {
  '21600001': ['Gaji', 'Cuti Tahunan'],
  '21600003': ['JASPRO'],
  '21600004': ['THR'],
  '21600005': ['JASPRO', 'GAJI'],
  '21600006': ['PCD PPH 21'],
  '21600008': ['BK REMBANG', 'BK TUBAN', 'LAIN-LAIN', 'TL REMBANG', 'TL TUBAN'],
  '21600009': ['PBB BABAT LAMONGAN', 'PBB BANGKALAN', 'PBB BANJARMASIN', 'PBB BANYUWANGI', 'PBB CIGADING', 'PBB DAGEN', 'PBB GRESIK', 'PBB JAKARTA', 'PBB LAMONGAN', 'PBB MEMPAWAH', 'PBB NAROGONG', 'PBB PASURUAN', 'PBB PELINDO', 'PBB PRIGEN', 'PBB REMBANG', 'PBB SAYUNG', 'PBB SIDOARJO', 'PBB SORONG', 'PBB SQ TOWER', 'PBB SURABAYA', 'PPB TUBAN'],
  '21600010': ['AAB TBN', 'Cigading', 'Infra', 'KEAMANAN GRESIK', 'KEAMANAN PP', 'KEAMANAN TUBAN', 'Kebersihan Gresik', 'Kebersihan Tuban', 'Lain-lain', 'Operasional Kantor', 'OPERASIONAL PABRIK', 'Parkir', 'PEMELIHARAAN ALL AREA PBR TUBAN', 'Pemeliharaan Autonomous', 'PEMELIHARAAN FM', 'PEMELIHARAAN GUSI & SQ', 'Pemeliharaan Listrik', 'Pemeliharaan Pbr Gresik', 'PEMELIHARAAN PBR TUBAN', 'REVERSE', 'TRANSPORTASI'],
  '21600011': ['GUNUNG SARI', 'PABRIK GRESIK', 'PABRIK TUBAN', 'PERDIN GRESIK', 'PERDIN TUBAN', 'PP CIGADING', 'REKLAS PLN'],
  '21600012': ['OA'],
  '21600018': ['LAIN-LAIN', 'JASA AUDIT', 'Marketing', 'LGRC', 'SDM', 'ICT'],
  '21600019': ['BILLBOARD, IKLAN, DAN PAJAK', 'Lainnya', 'Point', 'Product Knowledge', 'SALES PROMO'],
  '21600020': ['AAB TBN', 'AFVAL', 'ASET', 'ASURANSI', 'BAHAN', 'DEPT CLD 2021', 'DEPT QA', 'Dept Rnd', 'DEPT TREASURY', 'GCG', 'ICT', 'ICT LINK NET', 'Innovation Award', 'JAMUAN TAMU', 'Jasa audit', 'Kalender', 'Kantong', 'KENDARAAN PP', 'KOMSAR', 'KON HUKUM', 'KON PAJAK', 'KON TALENT', 'KSO', 'LAIN-LAIN', 'LGRC', 'Litbang', 'MAKLON CB', 'MAKLON CWD', 'Maklon TJP', 'MSA', 'Obligasi', 'PAJAK', 'PELABUHAN', 'Pengl. Gudang/Sprepart', 'PJK. UM OP Mgr Sales', 'Right Issue', 'ROYALTY', 'RT', 'SDM', 'Seragam', 'Set-Off Prepaid', 'SEWA KENDARAAN', 'SEWA PACKING PLAN', 'SPPD', 'Troughput', 'UKL PP', 'UM', 'UNIT SHE'],
  '21600021': ['CSR'],
  '21600022': ['GRESIK', 'TUBAN'],
  '21600024': ['BK REMBANG', 'BK TUBAN', 'BK TUBAN SM', 'Driver', 'Handak', 'Lain-lain', 'SOLAR REMBANG', 'SOLAR TUBAN', 'SUPPORT SG', 'SUPPORT TB', 'TL REMBANG', 'TL TUBAN'],
  '21600025': ['BALIKPAPAN', 'BANJARMASIN', 'BANYUWANGI', 'CELUKAN BAWANG', 'CIGADING', 'CIWANDAN', 'DC BUFFER', 'MAKLON', 'NAROGONG', 'PONTIANAK', 'SEWA PALET', 'SORONG', 'TERSUS TUBAN', 'TJ PRIOK', 'TUBAN'],
  '21600026': ['IAR', 'Asuransi Kesehatan'],
  '21600034': ['PD'],
  '21600007': ['PENGOBATAN'],
  '21600033': ['LAIN-LAIN'],
};

/**
 * Daftar klasifikasi detail untuk kode akun yang punya lebih dari satu detail
 * (untuk expand baris REKAP: 1 baris → N baris per detail).
 * Return undefined jika kode akun tidak punya detail atau hanya 1 opsi.
 */
export function getDetailKlasifikasiList(kdAkr: string): string[] | undefined {
  const list = KODE_AKUN_KLASIFIKASI[kdAkr];
  if (!list || list.length <= 1) return undefined;
  return list;
}

/**
 * True jika baris REKAP ini adalah baris summary/header "BIAYA YMH ..." yang tidak perlu di-import.
 * Untuk kode akun yang punya detail (21600001, 21600008, dll), hanya baris detail (Cuti Tahunan, Gaji, dll) yang masuk.
 */
export function isRekapSummaryRow(kdAkr: string, keterangan: string): boolean {
  if (!getDetailKlasifikasiList(kdAkr)) return false; // kode akun tanpa detail → semua baris dipakai
  const raw = String(keterangan || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  return upper.startsWith('BIAYA YMH') || upper.startsWith('BYA YMH');
}

/**
 * Menyesuaikan keterangan dari sheet REKAP (mis. "BIAYA YMH ...") ke klasifikasi
 * yang sudah ada. Strip prefix "BIAYA YMH" / "BYA YMH" dan cocokkan ke daftar klasifikasi
 * untuk kode akun tersebut.
 */
export function keteranganToKlasifikasi(kdAkr: string, keterangan: string): string {
  if (!keterangan || !kdAkr) return keterangan?.trim() || '';

  const raw = String(keterangan).trim();
  if (!raw) return '';

  const list = KODE_AKUN_KLASIFIKASI[kdAkr];
  if (!list || list.length === 0) return raw;

  // Ambil bagian setelah " - " jika ada (contoh: "BIAYA YMH GJ & KESJH - Gaji" -> "Gaji")
  let cleaned = raw;
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    cleaned = parts[parts.length - 1].trim();
  }
  // Hapus prefix umum
  const prefixRegex = /^(BIAYA\s+YMH|BYA\s+YMH|BIAYA\s+YMH\s+[^-]+)\s*[-–]?\s*/i;
  cleaned = cleaned.replace(prefixRegex, '').trim();
  if (!cleaned) cleaned = raw.trim();

  const cleanedLower = cleaned.toLowerCase();
  // Exact match (case insensitive)
  const exact = list.find((k) => k.toLowerCase() === cleanedLower);
  if (exact) return exact;
  // Contains: pilih yang paling cocok (klasifikasi ada di dalam keterangan atau sebaliknya)
  const contains = list.find(
    (k) =>
      cleanedLower.includes(k.toLowerCase()) ||
      k.toLowerCase().includes(cleanedLower)
  );
  if (contains) return contains;
  return cleaned || raw;
}
