/**
 * Server-Sent Events broadcaster.
 * Uses globalThis so the clients Map survives Next.js hot-reloads in development.
 */

type Controller = ReadableStreamDefaultController<Uint8Array>;

declare global {
  // eslint-disable-next-line no-var
  var __sseClients: Map<string, Controller> | undefined;
}

if (!globalThis.__sseClients) {
  globalThis.__sseClients = new Map();
}

const clients = globalThis.__sseClients!;

export function addClient(id: string, controller: Controller) {
  clients.set(id, controller);
}

export function removeClient(id: string) {
  clients.delete(id);
}

/**
 * Push an event to every connected SSE client.
 * Dead connections are automatically pruned.
 */
export function broadcast(event: string, data?: Record<string, unknown>) {
  const payload = new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`
  );

  const dead: string[] = [];

  for (const [id, controller] of clients) {
    try {
      controller.enqueue(payload);
    } catch {
      dead.push(id);
    }
  }

  for (const id of dead) clients.delete(id);
}
