import { NextResponse } from 'next/server';

// SSE endpoint disabled — real-time updates now use client-side polling
// (useRealtimeUpdates hook) to avoid persistent Vercel Fluid connections.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ disabled: true }, { status: 410 });
}
