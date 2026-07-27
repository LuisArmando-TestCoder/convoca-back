// ── Realtime stream route ────────────────────────────────────────────────────
// A WebSocket per (org, event) so every teammate viewing an event gets live
// email-send progress. Browsers can't set Authorization headers on a WS, so the
// session token is passed as `?token=` and validated here (not via requireAuth).
// Mounted OUTSIDE the authed events router to avoid the header requirement.

import { Hono } from "hono";
import { readSession } from "../lib/jwt.ts";
import { getOrg } from "../db/orgs.ts";
import { join, leave, roomKey } from "../socket/hub.ts";

const stream = new Hono();

// GET /api/stream/:eventId?token=...  → upgrades to a WebSocket in the org room.
stream.get("/:eventId", async (c) => {
  const upgrade = c.req.header("upgrade")?.toLowerCase();
  if (upgrade !== "websocket") return c.text("Expected a WebSocket upgrade.", 426);

  const token = c.req.query("token") ?? "";
  const claims = token ? await readSession(token) : null;
  if (!claims) return c.text("Invalid or missing session token.", 401);

  const org = await getOrg(claims.orgId);
  if (!org || !org.verified) return c.text("Organization not available.", 403);

  const eventId = c.req.param("eventId");
  const room = roomKey(claims.orgId, eventId);

  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
  socket.onopen = () => {
    join(room, socket);
    // Greet so the client can confirm the channel is live.
    try {
      socket.send(JSON.stringify({ t: "ready", room: eventId }));
    } catch { /* ignore */ }
  };
  socket.onclose = () => leave(room, socket);
  socket.onerror = () => leave(room, socket);
  // We don't expect inbound messages; ignore them (keep the socket read-only).

  return response;
});

export default stream;
