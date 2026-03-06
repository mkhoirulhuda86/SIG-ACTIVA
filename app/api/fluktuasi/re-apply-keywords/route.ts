import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    // 1. Fetch all keywords
    const keywords = await prisma.fluktuasiKeyword.findMany({
      orderBy: [{ priority: 'desc' }, { keyword: 'asc' }],
    }) as KW[];

    if (!keywords.length) {
      return NextResponse.json({ success: false, error: 'Belum ada keyword tersimpan.' }, { status: 400 });
    }

    // 2. Fetch all account codes that have stored rows
    const accounts = await prisma.fluktuasiSheetRows.findMany({
      select: { accountCode: true },
    });

    if (!accounts.length) {
      return NextResponse.json({ success: false, error: 'Tidak ada data baris tersimpan. Upload file terlebih dahulu.' }, { status: 400 });
    }

    let updatedRecords = 0;

    // 3. Process each account one by one to avoid loading all rows at once
    for (const { accountCode } of accounts) {
      const sheet = await prisma.fluktuasiSheetRows.findUnique({
        where:  { accountCode },
        select: { rows: true },
      });
      if (!sheet) continue;

      const rows = sheet.rows as Record<string, unknown>[];
      if (!rows?.length) continue;

      // Aggregate per period: collect distinct klasifikasi parts
      const periodeMap = new Map<string, Set<string>>();

      for (const row of rows) {
        const p          = String(row['__periode']         ?? '').trim();
        if (!p) continue;
        const sourceText = String(row['__klasifikasi_raw'] ?? '').trim();
        const docnoText  = String(row['__docno_raw']       ?? '').trim();

        const matched = matchKeywords(sourceText, keywords, 'klasifikasi', docnoText, row as Record<string, unknown>);

        if (!periodeMap.has(p)) periodeMap.set(p, new Set<string>());
        if (matched) {
          // split '; '-joined multi-results into individual parts
          for (const part of matched.split(';').map(s => s.trim()).filter(Boolean)) {
            periodeMap.get(p)!.add(part);
          }
        }
      }

      // 4. Update FluktuasiAkunPeriode for each period
      for (const [periode, klasSet] of periodeMap.entries()) {
        const klasifikasi = [...klasSet].join('; ');
        const result = await prisma.fluktuasiAkunPeriode.updateMany({
          where: { accountCode, periode },
          data:  { klasifikasi },
        });
        updatedRecords += result.count;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Klasifikasi berhasil diperbarui untuk ${updatedRecords} record dari ${accounts.length} akun.`,
      updatedRecords,
      accountsProcessed: accounts.length,
    });
  } catch (error) {
    console.error('Error re-applying keywords:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal memperbarui klasifikasi: ' + (error as Error).message },
      { status: 500 },
    );
  }
}
