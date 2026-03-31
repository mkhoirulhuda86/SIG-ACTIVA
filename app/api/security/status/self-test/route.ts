import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

type TestResult = {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
};

async function runRequest(
  url: string,
  init: RequestInit
): Promise<{ status: number; bodySnippet: string }> {
  try {
    const res = await fetch(url, init);
    const txt = await res.text();
    return { status: res.status, bodySnippet: txt.slice(0, 200) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    return { status: 0, bodySnippet: message };
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const origin = request.nextUrl.origin;
  const cookie = request.headers.get('cookie') || '';

  const tests: TestResult[] = [];

  // 1) CSRF defense check: forged origin on authenticated write request must be blocked.
  const csrfProbe = await runRequest(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://evil.example',
      referer: 'https://evil.example/attack',
    },
  });
  tests.push({
    name: 'csrf_block_write_request',
    ok: csrfProbe.status === 403,
    expected: 'HTTP 403',
    actual: `HTTP ${csrfProbe.status}`,
  });

  // 2) Unauthorized access check: protected finance API without cookie should be rejected.
  const unauthProbe = await runRequest(`${origin}/api/accrual`, {
    method: 'GET',
    headers: {
      origin,
    },
  });
  tests.push({
    name: 'unauthorized_finance_api_block',
    ok: unauthProbe.status === 401,
    expected: 'HTTP 401',
    actual: `HTTP ${unauthProbe.status}`,
  });

  // 3) Role/admin API check: users management API without cookie should be rejected.
  const adminProbe = await runRequest(`${origin}/api/users`, {
    method: 'GET',
    headers: {
      origin,
    },
  });
  tests.push({
    name: 'admin_api_requires_session',
    ok: adminProbe.status === 401 || adminProbe.status === 403,
    expected: 'HTTP 401/403',
    actual: `HTTP ${adminProbe.status}`,
  });

  const passed = tests.filter((t) => t.ok).length;
  const failed = tests.length - passed;

  return NextResponse.json({
    success: failed === 0,
    score: {
      passed,
      failed,
      total: tests.length,
    },
    tests,
    timestamp: new Date().toISOString(),
    notes: {
      csrfProbeBody: csrfProbe.bodySnippet,
      unauthProbeBody: unauthProbe.bodySnippet,
      adminProbeBody: adminProbe.bodySnippet,
    },
  });
}
