import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const dbErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  if (/maxclientsinsessionmode|max clients reached|pool_size/i.test(message)) {
    return 'Koneksi database penuh: jumlah koneksi aktif melebihi batas paket saat ini (max clients).';
  }
  if (/planLimitReached/i.test(message)) {
    return 'Koneksi database ditolak: limit paket Prisma sudah tercapai (planLimitReached).';
  }
  if (/P1001|Can\'t reach database server/i.test(message)) {
    return 'Koneksi database gagal (P1001): server database tidak terjangkau.';
  }
  return fallback;
};

// ─── Inline keyword matching (mirrors client-side matchKeywords) ──────────────
type KW = {
  keyword:      string;
  type:         string;
  result:       string;
  priority:     number;
  sourceColumn: string;
};

function matchKeywords(
  text:    string,
  kws:     KW[],
  type:    string,
  docno:   string = '',
  rowData?: Record<string, unknown>,
): string {
  if (!kws.length) return '';
  const textStr   = String(text  ?? '').trim();
  const textLower = textStr.toLowerCase();
  const docnoStr  = String(docno ?? '').trim();
  const collectAll = type === 'klasifikasi';

  const relevant  = kws.filter(k => k.type === type).sort((a, b) => b.priority - a.priority);
  const positive  = relevant.filter(k => !k.keyword.toLowerCase().startsWith('not:'));
  const negative  = relevant.filter(k =>  k.keyword.toLowerCase().startsWith('not:'));

  const getEffText = (kw: KW): { str: string; lower: string } => {
    const sc = (kw.sourceColumn ?? '').trim();
    if (sc && rowData) {
      const key = Object.keys(rowData).find(k => k.toLowerCase() === sc.toLowerCase());
      const val = key ? String(rowData[key] ?? '').trim() : '';
      if (val) return { str: val, lower: val.toLowerCase() };
    }
    return { str: textStr, lower: textLower };
  };

  const collected = new Set<string>();
  const add = (r: string): boolean => {
    const v = (r ?? '').trim();
    if (!v) return false;
    collected.add(v);
    return !collectAll; // stop early only for remark
  };

  for (const kw of positive) {
    const kwl = kw.keyword.toLowerCase();

    // col: mode
    if (kwl.startsWith('col:')) {
      if (!rowData) continue;
      const rest      = kw.keyword.slice(4);
      const ci        = rest.indexOf(':');
      if (ci < 0) continue;
      const colName   = rest.slice(0, ci).trim();
      const pattern   = rest.slice(ci + 1).trim();
      const key       = Object.keys(rowData).find(k => k.toLowerCase() === colName.toLowerCase());
      const colVal    = key ? String(rowData[key] ?? '').trim() : '';
      if (!colVal) continue;
      const pl = pattern.toLowerCase();
      let matched = false;
      if (pl.startsWith('regex:')) {
        try { matched = new RegExp(pattern.slice(6).trim(), 'i').test(colVal); } catch { /* ignore */ }
      } else if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.length > 2) {
        matched = colVal.toLowerCase().includes(pattern.slice(1, -1).toLowerCase());
      } else if (pattern.endsWith('*')) {
        matched = colVal.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
      } else if (pattern.startsWith('*')) {
        matched = colVal.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
      } else {
        matched = colVal.toLowerCase().includes(pattern.toLowerCase());
      }
      if (matched && add(kw.result || colVal)) return [...collected].join('; ');
      continue;
    }

    // docno: mode
    if (kwl.startsWith('docno:')) {
      if (!docnoStr) continue;
      const pattern = kw.keyword.slice(6).trim();
      if (pattern.toLowerCase().startsWith('regex:')) {
        try { if (new RegExp(pattern.slice(6).trim(), 'i').test(docnoStr) && add(kw.result)) return [...collected].join('; '); } catch { /* ignore */ }
      } else {
        if (docnoStr.startsWith(pattern) && add(kw.result)) return [...collected].join('; ');
      }
      continue;
    }

    // regex: mode
    if (kwl.startsWith('regex:')) {
      const { str: effStr } = getEffText(kw);
      try {
        const m = effStr.match(new RegExp(kw.keyword.slice(6).trim(), 'i'));
        if (m) {
          let r = kw.result;
          if (!r || r.trim() === '{match}') r = m[0];
          else {
            for (let i = 1; i < m.length; i++) r = r.replace(new RegExp(`\\{${i}\\}`, 'g'), m[i] ?? '');
            r = r.replace(/\{match\}/gi, m[0]);
          }
          if (add(r)) return [...collected].join('; ');
        }
      } catch { /* ignore */ }
      continue;
    }

    // normal includes
    const { lower: effLower } = getEffText(kw);
    if (effLower.includes(kwl)) {
      if (add(kw.result)) return [...collected].join('; ');
    }
  }

  if (collected.size > 0) return [...collected].join('; ');

  // NOT keywords: match if exclusion terms are absent
  for (const kw of negative) {
    const { lower: effLower } = getEffText(kw);
    const excls = kw.keyword.slice(4).trim().split(/[,|]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!excls.some(e => effLower.includes(e))) return kw.result;
  }

  return '';
}

// ─── POST /api/fluktuasi/re-apply-keywords ────────────────────────────────────
// Re-processes stored raw row data against current keywords and updates
// klasifikasi on all FluktuasiAkunPeriode records.
export async function POST() {
  try {
    // 1. Fetch keywords + all sheet rows in parallel (2 queries total)
    const [keywords, allSheets] = await Promise.all([
      prisma.fluktuasiKeyword.findMany({
        orderBy: [{ priority: 'desc' }, { keyword: 'asc' }],
      }) as Promise<KW[]>,
      prisma.fluktuasiSheetRows.findMany({
        select: { accountCode: true, rows: true },
      }),
    ]);

    if (!keywords.length) {
      return NextResponse.json({ success: false, error: 'Belum ada keyword tersimpan.' }, { status: 400 });
    }
    if (!allSheets.length) {
      return NextResponse.json({ success: false, error: 'Tidak ada data baris tersimpan. Upload file terlebih dahulu.' }, { status: 400 });
    }

    // 2. Pre-filter keywords once (avoids repeated filter inside matchKeywords)
    const klasKws = (keywords as KW[]).filter(k => k.type === 'klasifikasi').sort((a, b) => b.priority - a.priority);

    // 3. Process all sheets in memory → build update map: accountCode+periode → klasifikasi
    type UpdateItem = { accountCode: string; periode: string; klasifikasi: string };
    const updates: UpdateItem[] = [];

    for (const sheet of allSheets) {
      const rows = sheet.rows as Record<string, unknown>[];
      if (!rows?.length) continue;

      const periodeMap = new Map<string, Set<string>>();

      for (const row of rows) {
        const p = String(row['__periode'] ?? '').trim();
        if (!p) continue;

        const sourceText = String(row['__klasifikasi_raw'] ?? '').trim();
        const docnoText  = String(row['__docno_raw']       ?? '').trim();
        const matched    = matchKeywords(sourceText, klasKws, 'klasifikasi', docnoText, row);

        if (!periodeMap.has(p)) periodeMap.set(p, new Set<string>());
        if (matched) {
          for (const part of matched.split(';').map(s => s.trim()).filter(Boolean)) {
            periodeMap.get(p)!.add(part);
          }
        }
      }

      for (const [periode, klasSet] of periodeMap.entries()) {
        updates.push({
          accountCode:  sheet.accountCode,
          periode,
          klasifikasi: [...klasSet].join('; '),
        });
      }
    }

    if (!updates.length) {
      return NextResponse.json({ success: true, message: 'Tidak ada record untuk diperbarui.', updatedRecords: 0 });
    }

    // 4. Apply updates in small sequential chunks to minimize DB connection pressure
    const BATCH = 10;
    let updatedRecords = 0;

    for (let i = 0; i < updates.length; i += BATCH) {
      const chunk = updates.slice(i, i + BATCH);
      for (const u of chunk) {
        const r = await prisma.fluktuasiAkunPeriode.updateMany({
          where: { accountCode: u.accountCode, periode: u.periode },
          data: { klasifikasi: u.klasifikasi },
        });
        updatedRecords += r.count;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Klasifikasi berhasil diperbarui untuk ${updatedRecords} record dari ${allSheets.length} akun.`,
      updatedRecords,
      accountsProcessed: allSheets.length,
    });
  } catch (error) {
    console.error('Error re-applying keywords:', error);
    const message = dbErrorMessage(error, 'Gagal memperbarui klasifikasi');
    const status = /max clients|planLimitReached|P1001/i.test(String(error instanceof Error ? error.message : error ?? '')) ? 503 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status },
    );
  }
}
