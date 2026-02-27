import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { addClient, removeClient } from '@/lib/sse';

// Must run on Node.js runtime to keep persistent streaming connections
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const clientId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      addClient(clientId, controller);
      // Initial ping so browser confirms connection is alive
      controller.enqueue(encoder.encode(':connected\n\n'));
    },
    cancel() {
      removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable Nginx/Vercel buffering
    },
  });
}
