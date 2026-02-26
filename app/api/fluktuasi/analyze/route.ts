import { NextRequest, NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AmtPeriod {
  label: string;
  value: string | number | null | undefined;
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
    currLabel, prevMoMLabel, prevYoYLabel, amountPeriods } = body;

  // Build period table for prompt
  const periodLines = amountPeriods
    .map(p => `  ${p.label}: ${p.value !== '' && p.value !== null && p.value !== undefined
      ? fmtIDR(parseNum(p.value)) : '-'}`)
    .join('\n');

  const prompt = `Kamu adalah analis keuangan senior perusahaan Indonesia. Tugas kamu adalah membuat analisis fluktuasi yang lengkap, tajam, dan siap masuk laporan keuangan internal manajemen.

=== DATA AKUN ===
Kode Akun : ${accountCode || '-'}
Nama Akun : ${accountName || '-'}

=== HISTORI NILAI PER PERIODE (Rupiah) ===
${periodLines}

=== BESARAN FLUKTUASI ===
${type !== 'yoy' ? `MoM  : ${gapMoM >= 0 ? '+' : ''}${fmtIDR(gapMoM)} (${pctStr(pctMoM)})  →  ${currLabel} vs ${prevMoMLabel}` : ''}
${type !== 'mom' ? `YoY  : ${gapYoY >= 0 ? '+' : ''}${fmtIDR(gapYoY)} (${pctStr(pctYoY)})  →  ${currLabel} vs ${prevYoYLabel}` : ''}

=== INSTRUKSI ===
Buat analisis lengkap untuk setiap bagian yang diminta di bawah.

Aturan wajib:
1. Gunakan kalimat deklaratif langsung. DILARANG menggunakan kata: kemungkinan, mungkin, diperkirakan, diduga, tampaknya, sepertinya.
2. Baca tren histori semua periode di atas — sebutkan pola tren (naik konsisten, turun lalu naik, dsb.) jika relevan.
3. Setiap poin harus menyebut angka konkret dari data di atas (nilai atau persentase).
4. Tulis minimal 3 poin penyebab yang berbeda — tidak boleh hanya 1 atau 2.
5. Jika ada periode dengan lonjakan atau penurunan tajam, sebutkan periodenya secara eksplisit.
6. Cantumkan nilai dalam Miliar (M) atau Juta (JT).
7. Jika nilai fluktuasi 0 atau < 1%, cukup tulis: "Tidak ada fluktuasi signifikan."

=== FORMAT OUTPUT (ikuti persis, tanpa teks tambahan di luar format ini) ===
${type !== 'yoy' ? `[MOM]
${gapMoM >= 0 ? 'Kenaikan' : 'Penurunan'} ${accountName} sebesar ${fmtIDR(Math.abs(gapMoM))} (${pctStr(pctMoM)}) pada ${currLabel} dibandingkan ${prevMoMLabel}, dengan rincian sebagai berikut:
   - [Penyebab utama — sertakan angka spesifik]
   - [Penyebab kedua — sertakan angka atau tren]
   - [Penyebab ketiga — kaitkan dengan konteks operasional/keuangan akun ini]
   - [Penyebab tambahan jika relevan]
` : ''}${type !== 'mom' ? `[YOY]
${gapYoY >= 0 ? 'Kenaikan' : 'Penurunan'} ${accountName} sebesar ${fmtIDR(Math.abs(gapYoY))} (${pctStr(pctYoY)}) pada ${currLabel} dibandingkan ${prevYoYLabel}, dengan rincian sebagai berikut:
   - [Penyebab utama — sertakan angka spesifik]
   - [Penyebab kedua — sertakan angka atau tren]
   - [Penyebab ketiga — kaitkan dengan konteks operasional/keuangan akun ini]
   - [Penyebab tambahan jika relevan]
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
