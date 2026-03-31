import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceRead } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model: string;
  keyIdx?: number;   // 0 = OPENROUTER_API_KEY, 1–11 = OPENROUTER_API_KEY_N
  systemContext: string;
  messages: ChatMessage[];
}

// ─── Select the API key for the requested model ───────────────────────────────
function pickApiKey(keyIdx = 0): string {
  if (keyIdx >= 1 && keyIdx <= 11) {
    const k = process.env[`OPENROUTER_API_KEY_${keyIdx}`];
    if (k) return k;
  }
  // keyIdx 0 or missing numbered key → use the Free Models Router key
  return process.env.OPENROUTER_API_KEY ?? '';
}

// ─── POST /api/fluktuasi/chat ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireFinanceRead(req);
  if ('error' in auth) return auth.error;

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRateLimit = checkRateLimit(`fluktuasi-chat:ip:${clientIp}`, 25, 60_000);
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak request chat. Coba lagi sebentar.' },
      { status: 429, headers: { 'Retry-After': String(ipRateLimit.retryAfterSec) } }
    );
  }

  const body: ChatRequest = await req.json();
  const { model, keyIdx = 0, systemContext, messages } = body;

  const apiKey = pickApiKey(keyIdx);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Tidak ada OPENROUTER_API_KEY yang dikonfigurasi di .env.local' },
      { status: 500 },
    );
  }

  if (!messages?.length) {
    return NextResponse.json({ error: 'messages tidak boleh kosong' }, { status: 400 });
  }

  // Build messages array with system context as the first message
  const orMessages = [
    { role: 'system', content: systemContext || 'Kamu adalah analis keuangan senior perusahaan Indonesia.' },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://sig-activa.vercel.app',
        'X-Title': 'SIG Activa Fluktuasi Chat',
      },
      body: JSON.stringify({
        model: model || 'google/gemini-2.0-flash-001',
        messages: orMessages,
        temperature: 0.4,
        max_tokens: 2000,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      console.error('OpenRouter chat error:', orRes.status, errText);
      // Return a friendlier message for rate-limit errors
      if (orRes.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit tercapai. Coba lagi dalam beberapa detik, atau ganti model.' },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: `OpenRouter error ${orRes.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await orRes.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('Chat route error:', err);
    return NextResponse.json({ error: 'Gagal menghubungi OpenRouter' }, { status: 500 });
  }
}
