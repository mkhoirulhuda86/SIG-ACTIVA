import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName, verifySessionToken } from '@/lib/session';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(getSessionCookieName())?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.uid,
      role: session.role,
      name: session.name,
    },
  });
}
