// ── Convoca API server ───────────────────────────────────────────────────────
// A standalone multi-tenant event check-in SaaS. Deno + Hono + Deno KV. Each
// organization signs in passwordless (OTP over its own Gmail), runs events,
// invites participants (who receive a SHA-256 QR by email), and checks them in
// by scanning that QR — with a duplicate-scan safeguard.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { config } from "./src/config.ts";
import type { AppEnv } from "./src/context.ts";
import { requireAuth } from "./src/middleware/auth.ts";
import authRouter from "./src/routes/auth.ts";
import eventsRouter from "./src/routes/events.ts";
import collaboratorsRouter from "./src/routes/collaborators.ts";
import publicRouter from "./src/routes/public.ts";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: config.corsOrigins,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

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
app.route("/api/events", eventsRouter);
app.route("/api/collaborators", collaboratorsRouter);
app.route("/api/public", publicRouter);

// Centralized error shaping: HTTPException → its status; anything else → 500.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Internal server error." }, 500);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

Deno.serve({ port: config.port, onListen: ({ port }) => console.log(`convoca-api on :${port}`) }, app.fetch);
