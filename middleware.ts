import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, verifySessionToken } from '@/lib/session';

const PUBLIC_PAGE_PATHS = ['/login', '/register', '/verify-email'];
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/logout',
  '/api/users/check',
];
const ADMIN_PAGE_PATHS = ['/user-management', '/security-status', '/debug-user'];
const FINANCE_API_PREFIXES = ['/api/accrual', '/api/prepaid', '/api/fluktuasi', '/api/material-data'];
const FINANCE_READ_ROLES = [
  'ADMIN_SYSTEM',
  'STAFF_ACCOUNTING',
  'SUPERVISOR_ACCOUNTING',
  'AUDITOR_INTERNAL',
  'STAFF_PRODUCTION',
];
const FINANCE_WRITE_ROLES = ['ADMIN_SYSTEM', 'STAFF_ACCOUNTING'];
const POST_READ_LIKE_PATHS = ['/api/fluktuasi/analyze', '/api/fluktuasi/chat', '/api/fluktuasi/download'];

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
  );
  return response;
}

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function startsWithPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isFinanceApi(pathname: string): boolean {
  return FINANCE_API_PREFIXES.some((path) => startsWithPath(pathname, path));
}

function isPostReadLike(pathname: string): boolean {
  return POST_READ_LIKE_PATHS.some((path) => startsWithPath(pathname, path));
}

function isAdminPage(pathname: string): boolean {
  return ADMIN_PAGE_PATHS.some((path) => startsWithPath(pathname, path));
}

function isUnsafeMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function hasValidSameOrigin(request: NextRequest): boolean {
  const expectedOrigin = request.nextUrl.origin;
  const originHeader = request.headers.get('origin');
  const refererHeader = request.headers.get('referer');

  if (!originHeader && !refererHeader) return true;

  if (originHeader && originHeader !== expectedOrigin) return false;

  if (refererHeader) {
    try {
      const refererOrigin = new URL(refererHeader).origin;
      if (refererOrigin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const method = request.method.toUpperCase();

  const token = request.cookies.get(getSessionCookieName())?.value;
  const session = await verifySessionToken(token);
  const isAuthenticated = Boolean(session);

  if (isApi && !isPublicApi(pathname) && !isAuthenticated) {
    return applySecurityHeaders(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  if (isApi && pathname.startsWith('/api/users') && pathname !== '/api/users/check') {
    if (!session || session.role !== 'ADMIN_SYSTEM') {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      );
    }
  }

  if (isApi && isFinanceApi(pathname)) {
    const isReadRequest =
      method === 'GET' ||
      method === 'HEAD' ||
      method === 'OPTIONS' ||
      (method === 'POST' && isPostReadLike(pathname));

    if (!session) {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      );
    }

    const allowedRoles = isReadRequest ? FINANCE_READ_ROLES : FINANCE_WRITE_ROLES;
    if (!allowedRoles.includes(session.role)) {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      );
    }
  }

  if (isApi && isAuthenticated && isUnsafeMethod(method) && !hasValidSameOrigin(request)) {
    return applySecurityHeaders(
      NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    );
  }

  if (!isApi && !isPublicPage(pathname) && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (!isApi && isPublicPage(pathname) && isAuthenticated) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/', request.url)));
  }

  if (!isApi && isAdminPage(pathname)) {
    if (!session || session.role !== 'ADMIN_SYSTEM') {
      return applySecurityHeaders(NextResponse.redirect(new URL('/', request.url)));
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.png|.*\\.svg|.*\\.jpg|.*\\.jpeg|.*\\.gif|.*\\.webp|.*\\.ico|.*\\.css|.*\\.js).*)'],
};
