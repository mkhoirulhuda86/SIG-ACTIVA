import { useEffect, useRef } from 'react';

type Handler = (event: string) => void;

/**
 * Subscribe to Server-Sent Events from /api/events.
 * Calls `onUpdate(eventName)` immediately whenever a matching event is received.
 * Auto-reconnects after 3 s if the connection drops.
 *
 * @param events   SSE event names to listen to, e.g. ['accrual', 'prepaid']
 * @param onUpdate callback invoked with the event name on each incoming event
 */
export function useRealtimeUpdates(events: string[], onUpdate: Handler) {
  // Keep a stable ref so the effect never needs to re-run when onUpdate changes
  const onUpdateRef = useRef<Handler>(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource('/api/events');

      for (const name of events) {
        es.addEventListener(name, () => {
          onUpdateRef.current(name);
        });
      }

      es.onerror = () => {
        es?.close();
        // retry after 3 seconds
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
