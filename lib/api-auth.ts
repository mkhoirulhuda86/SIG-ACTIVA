import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, verifySessionToken } from '@/lib/session';

export type SessionUser = {
  uid: number;
  role: string;
  name: string;
};

const FINANCE_READ_ROLES = [
  'ADMIN_SYSTEM',
  'STAFF_ACCOUNTING',
  'SUPERVISOR_ACCOUNTING',
  'AUDITOR_INTERNAL',
  'STAFF_PRODUCTION',
];
const FINANCE_WRITE_ROLES = ['ADMIN_SYSTEM', 'STAFF_ACCOUNTING'];

export async function requireSession(
  request: NextRequest
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const token = request.cookies.get(getSessionCookieName())?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return {
    user: {
      uid: session.uid,
      role: session.role,
      name: session.name,
    },
  };
}

export async function requireAdmin(
  request: NextRequest
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireSession(request);
  if ('error' in auth) return auth;
  if (auth.user.role !== 'ADMIN_SYSTEM') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return auth;
}

export async function requireFinanceRead(
  request: NextRequest
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireSession(request);
  if ('error' in auth) return auth;
  if (!FINANCE_READ_ROLES.includes(auth.user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return auth;
}

export async function requireFinanceWrite(
  request: NextRequest
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireSession(request);
  if ('error' in auth) return auth;
  if (!FINANCE_WRITE_ROLES.includes(auth.user.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return auth;
}
