// ── Convoca API server ───────────────────────────────────────────────────────
// A standalone multi-tenant event check-in SaaS. Deno + Hono + Firestore. Each
// organization signs in passwordless (OTP email), runs events, invites
// participants (who receive a SHA-256 QR by email), and checks them in by
// scanning that QR — with a duplicate-scan safeguard.


import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { config } from "./src/config.ts";
import type { AppEnv } from "./src/context.ts";
import { requireAuth } from "./src/middleware/auth.ts";
import { rateLimit } from "./src/middleware/rateLimit.ts";
import authRouter from "./src/routes/auth.ts";
import eventsRouter from "./src/routes/events.ts";
import collaboratorsRouter from "./src/routes/collaborators.ts";
import participantsRouter from "./src/routes/participants.ts";
import certificatesRouter from "./src/routes/certificates.ts";
import publicRouter from "./src/routes/public.ts";
import streamRouter from "./src/routes/stream.ts";


const app = new Hono<AppEnv>();

// CORS — fully open. Auth is a stateless Bearer token, so wildcard origin is safe.
// Using a raw manual middleware instead of hono/cors so that Render's reverse proxy
// can't swallow the preflight response: OPTIONS gets an explicit 204 with all headers
// set in a fresh Response, and every other response also gets the allow-origin header.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    c.header(k, v);
  }
});

// Per-IP rate limiting with exponential backoff — mounted after CORS so
// preflight OPTIONS never counts against a client. Applies to every API route
// (and the health check) centrally, before any handler hits Firestore.
app.use("*", rateLimit({
  limit: config.rateLimitMax,
  windowMs: config.rateLimitWindowMs,
  basePenaltyMs: config.rateLimitBasePenaltyMs,
  maxPenaltyMs: config.rateLimitMaxPenaltyMs,
}));



// Health check.
app.get("/", (c) => c.json({ service: "convoca-api", ok: true }));

// Current session's org (safe fields only — never leaks the Gmail App Password).
app.get("/api/me", requireAuth, (c) => {
  const org = c.get("org");
  const session = c.get("session");
  return c.json({
    role: session.role,
    email: session.email,
    org: {
      id: org.id,
      name: org.name,
      email: org.email,
      gmailUser: org.gmailUser,
      verified: org.verified,
      createdAt: org.createdAt,
    },
  });
});

app.route("/api/auth", authRouter);
// Realtime WebSocket stream (query-token auth) — mounted before the authed
// events router so it isn't gated by the Bearer-header middleware.
app.route("/api/stream", streamRouter);
app.route("/api/events", eventsRouter);

app.route("/api/collaborators", collaboratorsRouter);
app.route("/api/participants", participantsRouter);
app.route("/api/certificates", certificatesRouter);
app.route("/api/public", publicRouter);

// Centralized error shaping: HTTPException → its status; anything else → 500.
// Explicitly set CORS headers here too so error responses (401, 404, 500…)
// are readable by the browser even when the middleware's post-next code skips.
app.onError((err, c) => {
  c.header("Access-Control-Allow-Origin", "*");
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Internal server error." }, 500);
});

app.notFound((c) => {
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({ error: "Not found." }, 404);
});


Deno.serve({ port: config.port, onListen: ({ port }) => console.log(`convoca-api on :${port}`) }, app.fetch);
