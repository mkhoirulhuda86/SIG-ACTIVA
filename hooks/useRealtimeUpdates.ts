import Pusher from 'pusher-js';
import { useEffect, useRef } from 'react';

type Handler = (event: string) => void;

/**
 * Subscribe to real-time events via Pusher Channels.
 * Calls `onUpdate(eventName)` immediately whenever a matching event is received.
 * No persistent server connections — uses Pusher's WebSocket infrastructure.
 *
 * @param events   Pusher event names to listen to, e.g. ['accrual', 'prepaid']
 * @param onUpdate callback invoked with the event name on each incoming event
 */
export function useRealtimeUpdates(events: string[], onUpdate: Handler) {
  const onUpdateRef = useRef<Handler>(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });

    const channel = pusher.subscribe('sig-activa');

    for (const name of events) {
      channel.bind(name, () => {
        onUpdateRef.current(name);
      });
    }

    return () => {
      channel.unbind_all();
      pusher.unsubscribe('sig-activa');
      pusher.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
