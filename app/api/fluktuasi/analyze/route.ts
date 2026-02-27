import { NextRequest, NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AmtPeriod {
  label: string;
  value: string | number | null | undefined;
}

interface SubBreakdownItem {
  klasifikasi: string;
  totalAmount: number;
  count?: number;
}

interface AnalyzeRequest {
  accountCode: string;
  accountName: string;
  type: 'mom' | 'yoy' | 'both';
  gapMoM?: number;
  pctMoM?: number;
  gapYoY?: number;
  pctYoY?: number;
  currLabel: string;
  prevMoMLabel: string;
  prevYoYLabel: string;
  amountPeriods: AmtPeriod[];
  subBreakdown?: SubBreakdownItem[];   // per-klasifikasi aggregated amounts for current period
  notes?: string;                       // optional context from user
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtIDR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1_000_000)     return `${(n / 1_000_000).toFixed(0)} JT`;
  if (abs >= 1_000)         return `${(n / 1_000).toFixed(0)} RB`;
  return n.toFixed(0);
}

function pctStr(p: number): string {
  return `${p >= 0 ? '+' : ''}${p.toFixed(2).replace('.', ',')}%`;
}

function parseNum(val: string | number | null | undefined): number {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const n = Number(String(val).replace(/\./g, '').replace(/,/g, '.'));
  return Number.isNaN(n) ? 0 : n;
}

// ─── POST /api/fluktuasi/analyze ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY belum dikonfigurasi di .env.local' }, { status: 500 });
  }

  const body: AnalyzeRequest = await req.json();
  const { accountCode, accountName, type, gapMoM = 0, pctMoM = 0, gapYoY = 0, pctYoY = 0,
    currLabel, prevMoMLabel, prevYoYLabel, amountPeriods, subBreakdown, notes } = body;

  // Build period table for prompt
  const periodLines = amountPeriods
    .map(p => `  ${p.label}: ${p.value !== '' && p.value !== null && p.value !== undefined
      ? fmtIDR(parseNum(p.value)) : '-'}`)
    .join('\n');

  // Build sub-breakdown section
  const subBreakdownLines = subBreakdown && subBreakdown.length > 0
    ? subBreakdown
        .map(sb => `  ${sb.klasifikasi}: ${fmtIDR(sb.totalAmount)}${sb.count ? ` (${sb.count} transaksi)` : ''}`)
        .join('\n')
    : '';

  const prompt = `Kamu adalah analis keuangan senior perusahaan Indonesia. Tugas kamu membuat narasi analisis fluktuasi yang JUJUR dan berdasarkan DATA AKTUAL di bawah ini saja.

=== AKUN ===
Kode  : ${accountCode || '-'}
Nama  : ${accountName || '-'}

=== HISTORI NILAI PER PERIODE ===
${periodLines}

=== FLUKTUASI YANG DIANALISIS ===
${type !== 'yoy' ? `MoM : ${gapMoM >= 0 ? '+' : ''}${fmtIDR(gapMoM)} (${pctStr(pctMoM)}) — ${currLabel} vs ${prevMoMLabel}` : ''}
${type !== 'mom' ? `YoY : ${gapYoY >= 0 ? '+' : ''}${fmtIDR(gapYoY)} (${pctStr(pctYoY)}) — ${currLabel} vs ${prevYoYLabel}` : ''}
${subBreakdownLines ? `
=== BREAKDOWN KLASIFIKASI TRANSAKSI (periode ${currLabel}) ===
${subBreakdownLines}
` : ''}${notes ? `=== CATATAN KONTEKS (dari pengguna) ===
${notes}

` : ''}=== PANDUAN ANALISIS ===
Tulis narasi analisis berdasarkan data di atas dengan ketentuan:
1. Jika ada BREAKDOWN KLASIFIKASI → identifikasi klasifikasi mana yang nilainya terbesar dan sebutkan angkanya.
2. Dari HISTORI PERIODE → identifikasi tren (konsisten naik/turun, ada lonjakan di periode tertentu, seasonal, dll).
3. Jika ada CATATAN KONTEKS → gunakan sebagai penjelasan penyebab.
4. DILARANG mengarang penyebab yang tidak ada di data — jika data tidak cukup menjelaskan sebab, cukup deskripsikan tren dan distribusi yang terlihat.
5. DILARANG menggunakan kata: kemungkinan, mungkin, diperkirakan, diduga, tampaknya.
6. Cantumkan angka konkret saat menyebut suatu poin.
7. Jika GAP < 1% atau nilai fluktuasi sangat kecil → langsung tulis: "Tidak ada fluktuasi signifikan."
8. Tiap bagian cukup 3–5 kalimat — langsung, padat, dan informatif.

=== FORMAT OUTPUT (ikuti persis, tanpa teks tambahan di luar format ini) ===
${type !== 'yoy' ? `[MOM]
<tulis analisis MoM di sini>
` : ''}${type !== 'mom' ? `[YOY]
<tulis analisis YoY di sini>
` : ''}`;

  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://sig-activa.vercel.app',
        'X-Title': 'SIG Activa Fluktuasi Analyzer',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',   // ganti model di sini jika diperlukan
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
        top_p: 0.85,
      }),
    });

    if (!orRes.ok) {
      const err = await orRes.text();
      console.error('OpenRouter API error:', err);
      return NextResponse.json({ error: `OpenRouter error: ${orRes.status} — ${err}` }, { status: 502 });
    }

    const data = await orRes.json();
    const rawText: string = data?.choices?.[0]?.message?.content ?? '';

    // Split into MoM and YoY sections
    let reasonMoM = '';
    let reasonYoY = '';

    if (type === 'mom') {
      reasonMoM = rawText.replace(/^\[MOM\]\s*/i, '').replace(/\[YOY\][\s\S]*/i, '').trim();
    } else if (type === 'yoy') {
      reasonYoY = rawText.replace(/^\[YOY\]\s*/i, '').replace(/\[MOM\][\s\S]*/i, '').trim();
    } else {
      const momMatch = rawText.match(/\[MOM\]([\s\S]*?)(?=\[YOY\]|$)/i);
      const yoyMatch = rawText.match(/\[YOY\]([\s\S]*?)$/i);
      reasonMoM = (momMatch?.[1] ?? '').trim();
      reasonYoY = (yoyMatch?.[1] ?? '').trim();
    }

    return NextResponse.json({ reasonMoM, reasonYoY, raw: rawText });
  } catch (err) {
    console.error('OpenRouter analyze error:', err);
    return NextResponse.json({ error: 'Gagal generate analisis' }, { status: 500 });
  }
}
