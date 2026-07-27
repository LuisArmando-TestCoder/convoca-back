// ── Realtime hub (in-memory) ─────────────────────────────────────────────────
// A tiny pub/sub over WebSockets, keyed by room. A room is one org's one event
// (`${orgId}:${eventId}`), so a socket only ever receives its own tenant's
// traffic. Used to stream live email-send progress to every teammate who has
// the event open. No external deps; state lives for the process lifetime.

export type Room = string; // `${orgId}:${eventId}`

export function roomKey(orgId: string, eventId: string): Room {
  return `${orgId}:${eventId}`;
}

const rooms = new Map<Room, Set<WebSocket>>();

export function join(room: Room, ws: WebSocket): void {
  let set = rooms.get(room);
  if (!set) rooms.set(room, (set = new Set()));
  set.add(ws);
}

export function leave(room: Room, ws: WebSocket): void {
  const set = rooms.get(room);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(room);
}

/** Fan-out a JSON message to every open socket in a room. Closed sockets are pruned. */
export function broadcast(room: Room, msg: unknown): void {
  const set = rooms.get(room);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch {
        // A failed send means the socket is dead; drop it.
        set.delete(ws);
      }
    }
  }
}

/** How many sockets are currently listening on a room (for "N teammates watching"). */
export function roomSize(room: Room): number {
  return rooms.get(room)?.size ?? 0;
}
