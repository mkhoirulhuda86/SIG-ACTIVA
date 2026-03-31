import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

function hasStrongSecret(secret: string | undefined): boolean {
  if (!secret) return false;
  if (secret === 'dev-insecure-secret-change-this') return false;
  return secret.length >= 32;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const nodeEnv = process.env.NODE_ENV || 'development';

  const checks: Check[] = [
    {
      name: 'auth_secret',
      ok: hasStrongSecret(authSecret),
      detail: hasStrongSecret(authSecret)
        ? 'AUTH_SECRET tersedia dan cukup kuat'
        : 'AUTH_SECRET belum ada/terlalu pendek (minimal 32 karakter)',
    },
    {
      name: 'production_mode',
      ok: nodeEnv === 'production',
      detail: nodeEnv === 'production'
        ? 'App berjalan di mode production'
        : `App masih mode ${nodeEnv}`,
    },
    {
      name: 'openrouter_key',
      ok: Boolean(process.env.OPENROUTER_API_KEY),
      detail: process.env.OPENROUTER_API_KEY
        ? 'OPENROUTER_API_KEY tersedia'
        : 'OPENROUTER_API_KEY belum diset',
    },
    {
      name: 'webpush_public_key',
      ok: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      detail: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ? 'NEXT_PUBLIC_VAPID_PUBLIC_KEY tersedia'
        : 'NEXT_PUBLIC_VAPID_PUBLIC_KEY belum diset',
    },
  ];

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;

  return NextResponse.json({
    success: true,
    score: {
      passed,
      failed,
      total: checks.length,
    },
    checks,
    timestamp: new Date().toISOString(),
  });
}
