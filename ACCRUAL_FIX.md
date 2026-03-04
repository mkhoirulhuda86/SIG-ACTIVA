# Fix: Total Accrual Per Item Tidak Bertambah

## Masalah
Total accrual per item tidak bertambah meskipun realisasi di tiap periode sudah terpenuhi.

## Penyebab
Ada beberapa potensi masalah dalam logika perhitungan accrual:

1. **Pengecekan `hasRealisasi` kurang robust**: Menggunakan `(p.totalRealisasi || 0) > 0` yang bisa menghasilkan false positive/negative dengan falsy values.

2. **Perbandingan tanggal tidak konsisten**: Membandingkan objek Date lengkap dengan timestamp, bukan hanya tanggal.

3. **Tidak ada logging untuk debugging**: Sulit untuk mengetahui apakah kondisi `hasRealisasi` ter-trigger dengan benar.

## Solusi yang Diterapkan

### 1. Perbaikan Logika `hasRealisasi`
**Sebelum:**lah aku ngubah nilai di accrual tiap periode kok amount di per item nya juga ikut berubah
```typescript
const hasRealisasi = (p.totalRealisasi || 0) > 0;
```

**Sesudah:**
```typescript
const totalRealisasi = p.totalRealisasi ?? 0;
const hasRealisasi = totalRealisasi > 0;
```

Menggunakan nullish coalescing operator (`??`) yang lebih eksplisit dan memisahkan logic menjadi dua baris untuk clarity.

### 2. Perbaikan Perbandingan Tanggal
**Sebelum:**
```typescript
const periodeDate = new Date(periodeTahun, periodeBulan, 1);
const today = new Date();
if (today >= periodeDate || hasRealisasi) {
  return sum + p.amountAccrual;
}
```

**Sesudah:**
```typescript
const today = new Date();
const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const periodeDateOnly = new Date(periodeTahun, periodeBulan, 1);

if (todayDate >= periodeDateOnly || hasRealisasi) {
  return sum + p.amountAccrual;
}
```

Sekarang hanya membandingkan tanggal (tahun, bulan, hari) tanpa mempertimbangkan jam/menit/detik.

### 3. Penambahan Logging untuk Debugging

**Backend (app/api/accrual/route.ts):**
```typescript
if (totalRealisasi > 0) {
  console.log(`Periode ${periode.bulan} has realisasi: ${totalRealisasi}, accrual: ${periode.amountAccrual}`);
}
```

**Frontend (app/monitoring-accrual/page.tsx):**
```typescript
if (hasRealisasi && todayDate < periodeDateOnly) {
  console.log(`[DEBUG] Recognizing future period ${p.bulan} due to realisasi: ${totalRealisasi}, accrual: ${p.amountAccrual}`);
}
```

## File yang Diubah
1. `app/monitoring-accrual/page.tsx` - 6 lokasi perhitungan accrual diperbaiki
2. `app/api/accrual/route.ts` - Ditambahkan logging

## Cara Verifikasi Fix

### 1. Buka browser dan cek console log
- Buka DevTools (F12)
- Akses halaman Monitoring Accrual
- Periksa console log untuk message debug

### 2. Test scenario:
1. Buat accrual baru dengan periode di masa depan (contoh: Maret 2026 - Juni 2026)
2. Total accrual yang ditampilkan seharusnya **0** atau hanya periode yang sudah jatuh tempo
3. Tambahkan realisasi ke periode Maret 2026 (yang belum jatuh tempo)
4. **Total accrual seharusnya langsung bertambah** meskipun periodenya belum tiba
5. Verify di tabel bahwa Total Accrual sekarang mencakup periode yang ada realisasinya

### 3. Cek server logs:
```bash
npm run dev
```

Lihat log di terminal untuk message seperti:
```
Periode Mar 2026 has realisasi: 500000, accrual: 500000
```

### 4. Cek browser console:
Saat ada realisasi di periode masa depan, seharusnya muncul log:
```
[DEBUG] Recognizing future period Mar 2026 due to realisasi: 500000, accrual: 500000
```

## Expected Behavior Setelah Fix

### Untuk pembagianType = 'otomatis':
- **Periode yang sudah jatuh tempo (today >= periode date)**: Accrual diakui ✓
- **Periode yang belum jatuh tempo TAPI ada realisasi**: Accrual JUGA diakui ✓
- **Periode yang belum jatuh tempo DAN tidak ada realisasi**: Accrual TIDAK diakui ✗

### Untuk pembagianType = 'manual':
- **Semua periode**: Accrual langsung diakui ✓

## Troubleshooting

Jika masalah masih terjadi:

1. **Clear browser cache**: Ctrl+Shift+Del
2. **Restart dev server**: Kill dan jalankan ulang `npm run dev`
3. **Cek data di database**: 
   ```sql
   SELECT ap.*, ar.* 
   FROM "AccrualPeriode" ap 
   LEFT JOIN "AccrualRealisasi" ar ON ap.id = ar."accrualPeriodeId"
   WHERE ap."bulan" LIKE '%2026%'
   ORDER BY ap."periodeKe";
   ```
4. **Periksa response API**: 
   - Network tab di DevTools
   - Lihat response dari `/api/accrual`
   - Pastikan field `totalRealisasi` ada di setiap periode

## Logging (Optional)

Jika sudah yakin fix bekerja, logging bisa dihapus untuk production:
- Hapus console.log di `app/api/accrual/route.ts` line ~90
- Hapus console.log di `app/monitoring-accrual/page.tsx` line ~246

## Testing Script

Saya sudah membuat script test `test-accrual-calculation.ts` untuk verifikasi logika (perlu konfigurasi database untuk menjalankannya).

---
**Tanggal Fix**: 9 Februari 2026
**File Terdampak**: 2 files, 7+ locations
