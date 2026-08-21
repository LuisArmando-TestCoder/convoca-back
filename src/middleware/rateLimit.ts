// ── Per-IP rate limiting with exponential backoff ────────────────────────────
// A fixed-window counter per client IP. When an IP exceeds its window budget it
// is "backed off": further requests are rejected with 429 + Retry-After until
// the penalty expires. Each consecutive violation doubles the penalty, so a
// persistent abuser is pushed away exponentially while a one-off burst recovers
// quickly. State is in-memory (per-instance), which is the right tradeoff for a
// single-process Deno deployment behind Render's proxy.

import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../context.ts";

export interface RateLimitOptions {
  /** Max requests allowed per window. Default 120. */
  limit?: number;
  /** Window length in ms. Default 60s. */
  windowMs?: number;
  /** Initial backoff penalty in ms. Default 30s. */
  basePenaltyMs?: number;
  /** Cap on the backoff penalty in ms. Default 15min. */
  maxPenaltyMs?: number;
  /** Backoff multiplier per consecutive violation. Default 2. */
  factor?: number;
  /** Optional key override (defaults to the client IP). */
  keyFn?: (c: Context<AppEnv>) => string;
}

interface Bucket {
  windowStart: number;
  count: number;
  penaltyUntil: number;
  penaltyMs: number;
}

export function rateLimit(opts: RateLimitOptions = {}) {
  const {
    limit = 120,
    windowMs = 60_000,
    basePenaltyMs = 30_000,
    maxPenaltyMs = 900_000,
    factor = 2,
    keyFn,
  } = opts;

  const buckets = new Map<string, Bucket>();

  // Opportunistic cleanup so long-lived processes don't leak IP entries.
  let lastSweep = Date.now();
  function sweep(now: number): void {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, b] of buckets) {
      if (b.penaltyUntil <= now && now - b.windowStart > windowMs) buckets.delete(key);
    }
  }

  return createMiddleware<AppEnv>(async (c, next) => {
    // Preflight checks are cheap and non-mutating; never count them against a
    // client (also keeps standalone mounts safe when there's no CORS layer).
    if (c.req.method === "OPTIONS") return next();

    const now = Date.now();
    sweep(now);

    const key = keyFn ? keyFn(c) : clientIp(c);
    let b = buckets.get(key);

    if (!b || now - b.windowStart >= windowMs) {
      b = { windowStart: now, count: 0, penaltyUntil: 0, penaltyMs: basePenaltyMs };
      buckets.set(key, b);
    }

    // Active backoff: reject until the penalty expires.
    if (b.penaltyUntil > now) {
      const retryAfter = Math.ceil((b.penaltyUntil - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "Too many requests. Slow down and retry later." },
        429,
      );
    }

    b.count++;

    if (b.count > limit) {
      // Violation: start/extend the backoff penalty exponentially.
      b.penaltyMs = Math.min(maxPenaltyMs, b.penaltyMs * factor);
      b.penaltyUntil = now + b.penaltyMs;
      const retryAfter = Math.ceil(b.penaltyMs / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "Too many requests. Slow down and retry later." },
        429,
      );
    }

    await next();
  });
}

/** Resolves the client IP, honoring the common reverse-proxy headers. */
function clientIp(c: Context<AppEnv>): string {
  const req = c.req.raw;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}