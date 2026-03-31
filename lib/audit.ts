import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/api-auth';

type AuditInput = {
  request: NextRequest;
  user: SessionUser;
  action: string;
  target?: string;
  success: boolean;
  detail?: string;
};

export function logAuditEvent(input: AuditInput): void {
  const ip = input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const entry = {
    ts: new Date().toISOString(),
    userId: input.user.uid,
    role: input.user.role,
    action: input.action,
    target: input.target ?? '',
    success: input.success,
    detail: input.detail ?? '',
    ip,
    path: input.request.nextUrl.pathname,
    method: input.request.method,
  };

  // Structured audit line, easy to parse from logs.
  console.info('[AUDIT]', JSON.stringify(entry));
}
