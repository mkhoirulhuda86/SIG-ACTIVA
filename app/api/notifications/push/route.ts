import { NextRequest, NextResponse } from 'next/server';
import { sendPushToAll } from '@/lib/webpush';

// POST /api/notifications/push — trigger push notification to all subscribers
export async function POST(request: NextRequest) {
  try {
    const { title, body, url, tag, priority } = await request.json();

    if (!title || !body) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
    }

    const result = await sendPushToAll({ title, body, url, tag, priority });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Push error:', error);
    return NextResponse.json({ error: 'Failed to send push' }, { status: 500 });
  }
}
