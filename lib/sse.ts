import Pusher from 'pusher';

/**
 * Pusher Channels broadcaster.
 * Replaces SSE to avoid persistent Vercel Fluid connections.
 * Channel: 'sig-activa', events: 'accrual' | 'prepaid' | 'material' | 'fluktuasi' | 'users'
 */

let _pusher: Pusher | null = null;

function getPusher(): Pusher {
  if (!_pusher) {
    _pusher = new Pusher({
      appId:   process.env.PUSHER_APP_ID!,
      key:     process.env.PUSHER_KEY!,
      secret:  process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS:  true,
    });
  }
  return _pusher;
}

/** Fire-and-forget broadcast to all subscribed clients. */
export function broadcast(event: string, data?: Record<string, unknown>) {
  getPusher().trigger('sig-activa', event, data ?? {}).catch((err: unknown) => {
    console.error('[Pusher] broadcast error:', err);
  });
}

/** Legacy no-ops kept so SSE route import doesn't break during transition. */
export function addClient() {}
export function removeClient() {}
