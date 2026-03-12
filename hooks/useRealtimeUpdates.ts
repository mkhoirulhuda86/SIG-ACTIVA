import Pusher, { Channel } from 'pusher-js';
import { useEffect, useRef } from 'react';

type Handler = (event: string) => void;

// ─── Singleton Pusher instance shared across all hook usages per tab ──────────
let _pusherClient: Pusher | null = null;
let _channel: Channel | null = null;
let _refCount = 0;

function getSharedChannel(): Channel {
  if (!_pusherClient) {
    _pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });
  }
  if (!_channel) {
    _channel = _pusherClient.subscribe('sig-activa');
  }
  _refCount++;
  return _channel;
}

function releaseSharedChannel() {
  _refCount--;
  if (_refCount <= 0 && _pusherClient) {
    _pusherClient.unsubscribe('sig-activa');
    _pusherClient.disconnect();
    _pusherClient = null;
    _channel = null;
    _refCount = 0;
  }
}

/**
 * Subscribe to real-time events via Pusher Channels.
 * Uses a shared singleton connection — multiple callers share one WebSocket.
 */
export function useRealtimeUpdates(events: string[], onUpdate: Handler) {
  const onUpdateRef = useRef<Handler>(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const channel = getSharedChannel();
    // unique handler per hook instance so unbind works correctly
    const handlers: Record<string, () => void> = {};

    for (const name of events) {
      const handler = () => onUpdateRef.current(name);
      handlers[name] = handler;
      channel.bind(name, handler);
    }

    return () => {
      for (const [name, handler] of Object.entries(handlers)) {
        channel.unbind(name, handler);
      }
      releaseSharedChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
