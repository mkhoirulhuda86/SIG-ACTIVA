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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY belum dikonfigurasi di .env.local' }, { status: 500 });
  }

  const body: AnalyzeRequest = await req.json();
  const { accountCode, accountName, type, gapMoM = 0, pctMoM = 0, gapYoY = 0, pctYoY = 0,
    currLabel, prevMoMLabel, prevYoYLabel, amountPeriods } = body;

  // Build period table for prompt
  const periodLines = amountPeriods
    .map(p => `  ${p.label}: ${p.value !== '' && p.value !== null && p.value !== undefined
      ? fmtIDR(parseNum(p.value)) : '-'}`)
    .join('\n');

  const momDirection = gapMoM >= 0 ? 'kenaikan' : 'penurunan';
  const yoyDirection = gapYoY >= 0 ? 'kenaikan' : 'penurunan';

  const prompt = `Kamu adalah analis keuangan profesional perusahaan Indonesia. Buat analisis fluktuasi singkat untuk laporan keuangan.

Detail akun:
- Kode Akun: ${accountCode || '-'}
- Nama Akun: ${accountName || '-'}

Data per periode (dalam Rupiah):
${periodLines}

Perbandingan:
- MoM (${currLabel} vs ${prevMoMLabel}): ${momDirection} ${fmtIDR(Math.abs(gapMoM))} (${pctStr(pctMoM)})
- YoY (${currLabel} vs ${prevYoYLabel}): ${yoyDirection} ${fmtIDR(Math.abs(gapYoY))} (${pctStr(pctYoY)})

Buat analisis untuk:
${type === 'mom' ? '1. Reason MoM saja' : type === 'yoy' ? '1. Reason YoY saja' : '1. Reason MoM\n2. Reason YoY'}

Format WAJIB (sesuai contoh berikut, dalam Bahasa Indonesia profesional):
${type !== 'yoy' ? `[MOM]
${gapMoM >= 0 ? 'Kenaikan' : 'Penurunan'} ${accountName} senilai ${fmtIDR(Math.abs(gapMoM))} atas rincian berikut:
   - [Kemungkinan penyebab 1 berdasarkan nama akun dan tren data]
   - [Kemungkinan penyebab 2]
` : ''}${type !== 'mom' ? `[YOY]
${gapYoY >= 0 ? 'Kenaikan' : 'Penurunan'} ${accountName} senilai ${fmtIDR(Math.abs(gapYoY))} atas rincian berikut:
   - [Kemungkinan penyebab 1 berdasarkan nama akun dan tren data]
   - [Kemungkinan penyebab 2]
` : ''}
Tulis 2-3 poin kemungkinan penyebab fluktuasi berdasarkan nama akun, tren data antar periode, dan konteks keuangan umum perusahaan. Cantumkan nilai dalam Miliar/Juta. Jika fluktuasi ${'< 1%'} atau nol, tuliskan "Tidak ada fluktuasi signifikan". Gunakan kata "${gapMoM >= 0 ? 'Kenaikan' : 'Penurunan'}" di awal kalimat.
Balas HANYA dengan teks analisis saja, tidak ada penjelasan tambahan.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
            topP: 0.9,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini API error:', err);
      return NextResponse.json({ error: `Gemini error: ${geminiRes.status}` }, { status: 502 });
    }

    const data = await geminiRes.json();
    const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

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
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Gagal generate analisis' }, { status: 500 });
  }
}
