/**
 * notificationChecker.ts
 * After data imports, check for alert conditions and push them to the browser.
 * Uses an in-memory dedup map (1-hour TTL) to avoid repeated pushes for the same alert.
 */

import { prisma } from '@/lib/prisma';
import { sendPushToAll } from '@/lib/webpush';

// In-memory dedup — key = alert id, value = timestamp last pushed
const pushedCache = new Map<string, number>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function shouldPush(id: string): boolean {
  const last = pushedCache.get(id);
  if (!last) return true;
  return Date.now() - last > CACHE_TTL_MS;
}

function markPushed(id: string) {
  pushedCache.set(id, Date.now());
}

// ─── Material selisih check ─────────────────────────────────────────────────
export async function checkMaterialAlerts() {
  try {
    const latest = await prisma.materialData.findFirst({
      select: { importDate: true },
      orderBy: { importDate: 'desc' },
    });
    if (!latest) return;

    const data = await prisma.materialData.findMany({
      where: {
        importDate: latest.importDate,
        OR: [
          { stokAwalSelisih: { not: 0 } },
          { produksiSelisih: { not: 0 } },
          { rilisSelisih: { not: 0 } },
          { stokAkhirSelisih: { not: 0 } },
        ],
      },
      select: {
        materialId: true,
        materialName: true,
        location: true,
        stokAwalSelisih: true,
        produksiSelisih: true,
        rilisSelisih: true,
        stokAkhirSelisih: true,
      },
      take: 20,
    });

    const high = data.filter((m) => {
      const max = Math.max(
        Math.abs(m.stokAwalSelisih),
        Math.abs(m.produksiSelisih),
        Math.abs(m.rilisSelisih),
        Math.abs(m.stokAkhirSelisih),
      );
      return max > 100;
    });

    if (high.length === 0) return;

    const id = `material-selisih-${latest.importDate.toISOString().slice(0, 10)}`;
    if (!shouldPush(id)) return;

    const topItem = high[0];
    const maxSelisih = Math.max(
      Math.abs(topItem.stokAwalSelisih),
      Math.abs(topItem.produksiSelisih),
      Math.abs(topItem.rilisSelisih),
      Math.abs(topItem.stokAkhirSelisih),
    );

    await sendPushToAll({
      title: `Selisih Material Ditemukan (${high.length} item)`,
      body: `${topItem.materialName} (${topItem.location}) — selisih maks: ${maxSelisih.toLocaleString('id-ID')}`,
      url: '/laporan-material',
      priority: 'high',
    });

    markPushed(id);
  } catch { /* silent */ }
}

// ─── Accrual perlu direalisasi check ────────────────────────────────────────
export async function checkAccrualAlerts() {
  try {
    const today = new Date();
    const bulanMap: { [k: string]: number } = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, Mei: 4, Jun: 5,
      Jul: 6, Agu: 7, Sep: 8, Okt: 9, Nov: 10, Des: 11,
    };

    const accruals = await prisma.accrual.findMany({
      select: {
        id: true,
        vendor: true,
        kdAkr: true,
        periodes: {
          select: {
            id: true,
            bulan: true,
            amountAccrual: true,
            realisasis: { select: { amount: true } },
          },
          take: 50,
        },
      },
      take: 500,
    });

    const needRealisasi: string[] = [];

    accruals.forEach((accrual) => {
      accrual.periodes.forEach((periode) => {
        const [bulanName, tahunStr] = periode.bulan.split(' ');
        const periodeDate = new Date(parseInt(tahunStr), bulanMap[bulanName] ?? 0, 1);
        if (today < periodeDate) return;

        const totalReal = periode.realisasis.reduce((s, r) => s + Math.abs(r.amount), 0);
        const abs = Math.abs(periode.amountAccrual);
        const saldo = abs - totalReal;
        if (saldo > abs * 0.5) needRealisasi.push(accrual.vendor);
      });
    });

    if (needRealisasi.length === 0) return;

    const id = `accrual-unrealized-${new Date().toISOString().slice(0, 10)}`;
    if (!shouldPush(id)) return;

    await sendPushToAll({
      title: `${needRealisasi.length} Accrual Perlu Direalisasi`,
      body: `Termasuk: ${needRealisasi.slice(0, 2).join(', ')}${needRealisasi.length > 2 ? ` dan ${needRealisasi.length - 2} lainnya` : ''}`,
      url: '/monitoring-accrual',
      priority: 'high',
    });

    markPushed(id);
  } catch { /* silent */ }
}

// ─── Prepaid perlu diamortisasi check ───────────────────────────────────────
export async function checkPrepaidAlerts() {
  try {
    const today = new Date();
    const bulanMap: { [k: string]: number } = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, Mei: 4, Jun: 5,
      Jul: 6, Agu: 7, Sep: 8, Okt: 9, Nov: 10, Des: 11,
    };

    const prepaids = await prisma.prepaid.findMany({
      select: {
        vendor: true,
        kdAkr: true,
        periodes: {
          select: {
            id: true,
            bulan: true,
            amountPrepaid: true,
            isAmortized: true,
          },
          take: 50,
        },
      },
      take: 500,
    });

    const needAmortize: string[] = [];

    prepaids.forEach((prepaid) => {
      prepaid.periodes.forEach((periode) => {
        const [bulanName, tahunStr] = periode.bulan.split(' ');
        const periodeDate = new Date(parseInt(tahunStr), bulanMap[bulanName] ?? 0, 1);
        if (today >= periodeDate && !periode.isAmortized) {
          needAmortize.push(prepaid.vendor ?? '');
        }
      });
    });

    if (needAmortize.length === 0) return;

    const id = `prepaid-unamortized-${new Date().toISOString().slice(0, 10)}`;
    if (!shouldPush(id)) return;

    await sendPushToAll({
      title: `${needAmortize.length} Prepaid Perlu Diamortisasi`,
      body: `Termasuk: ${[...new Set(needAmortize)].slice(0, 2).join(', ')}${needAmortize.length > 2 ? ` dan ${needAmortize.length - 2} lainnya` : ''}`,
      url: '/monitoring-prepaid',
      priority: 'high',
    });

    markPushed(id);
  } catch { /* silent */ }
}

// ─── Fluktuasi alerts check ──────────────────────────────────────────────────
export async function checkFluktuasiAlerts() {
  try {
    const unclassified = await prisma.fluktuasiAkunPeriode.groupBy({
      by: ['accountCode'],
      _sum: { amount: true },
      where: { klasifikasi: '' },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });

    if (unclassified.length > 0) {
      const id = `fluktuasi-unclassified-${new Date().toISOString().slice(0, 10)}`;
      if (shouldPush(id)) {
        await sendPushToAll({
          title: `${unclassified.length} Akun Fluktuasi Belum Terklasifikasi`,
          body: `Terbesar: ${unclassified[0].accountCode} — Rp ${Math.abs(unclassified[0]._sum.amount ?? 0).toLocaleString('id-ID')}`,
          url: '/fluktuasi-oi',
          priority: 'medium',
        });
        markPushed(id);
      }
    }

    const large = await prisma.fluktuasiAkunPeriode.findMany({
      where: { amount: { gt: 500_000_000 } },
      orderBy: { amount: 'desc' },
      select: { id: true, accountCode: true, periode: true, amount: true },
      take: 3,
    });

    if (large.length > 0) {
      const id = `fluktuasi-large-${new Date().toISOString().slice(0, 10)}`;
      if (shouldPush(id)) {
        await sendPushToAll({
          title: `${large.length} Fluktuasi Nilai Besar Terdeteksi`,
          body: `Akun ${large[0].accountCode}: Rp ${large[0].amount.toLocaleString('id-ID')}`,
          url: '/overview-fluktuasi',
          priority: 'high',
        });
        markPushed(id);
      }
    }
  } catch { /* silent */ }
}
