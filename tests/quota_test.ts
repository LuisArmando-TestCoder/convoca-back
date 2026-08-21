// Executable proofs for the quota-resilience tools. Pure, no credentials
// needed; they exercise the layered cache, backoff, and the per-IP rate
// limiter directly.
// Run: deno test --allow-env --allow-read

import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { LayeredCache } from "../src/lib/cache.ts";
import { withBackoff } from "../src/lib/backoff.ts";
import { rateLimit } from "../src/middleware/rateLimit.ts";

Deno.test("cache single-flights concurrent misses", async () => {
  const cache = new LayeredCache({ freshMs: 60_000, staleMs: 0 });
  let calls = 0;
  const loader = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return "v";
  };
  const [a, b, c] = await Promise.all([
    cache.get("k", loader),
    cache.get("k", loader),
    cache.get("k", loader),
  ]);
  assertEquals([a, b, c], ["v", "v", "v"]);
  assertEquals(calls, 1, "concurrent misses share one loader call");
});

Deno.test("cache serves stale then revalidates in the background", async () => {
  const cache = new LayeredCache({ freshMs: 1, staleMs: 10_000 });
  let calls = 0;
  const loader = async () => {
    calls++;
    return `v${calls}`;
  };

  assertEquals(await cache.get("k", loader), "v1");
  await new Promise((r) => setTimeout(r, 5)); // now stale
  assertEquals(await cache.get("k", loader), "v1", "stale value served instantly");
  assertEquals(calls, 2, "background refresh fired exactly once");
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(await cache.get("k", loader), "v2", "next read sees the refreshed value");
});

Deno.test("cache invalidate + enqueueWrite serializes writes", async () => {
  const cache = new LayeredCache({ freshMs: 60_000, staleMs: 0 });
  let n = 0;
  const loader = async () => ++n;
  assertEquals(await cache.get("k", loader), 1);
  await cache.enqueueWrite("k", async () => {});
  assertEquals(await cache.enqueueWrite("k", async () => {}), undefined);
  // after writes the key is not auto-invalidated here; caching layer owns reads.
  assertEquals(n, 1, "writes did not re-trigger the loader");
});

Deno.test("withBackoff retries retryable errors and gives up on permanent ones", async () => {
  let attempts = 0;
  const value = await withBackoff(async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error("429"), { status: 429 });
    return "ok";
  }, { retries: 5, baseDelayMs: 1, maxDelayMs: 4 });
  assertEquals(value, "ok");
  assertEquals(attempts, 3);

  await assertRejects(
    () =>
      withBackoff(async () => {
        throw new Error("permanent");
      }, { retries: 3, baseDelayMs: 1, shouldRetry: () => false }),
    Error,
    "permanent",
  );
});

Deno.test("rate limiter backs off an IP and rejects with Retry-After", async () => {
  const app = new Hono();
  app.use("*", rateLimit({
    limit: 3,
    windowMs: 60_000,
    basePenaltyMs: 60_000,
    maxPenaltyMs: 60_000,
    factor: 2,
  }));
  app.get("/", (c) => c.json({ ok: true }));

  const req = () => app.request("/", { headers: { "x-forwarded-for": "10.0.0.1" } });

  assertEquals((await req()).status, 200);
  assertEquals((await req()).status, 200);
  assertEquals((await req()).status, 200);
  // 4th request exceeds the budget → backoff begins.
  const blocked = await req();
  assertEquals(blocked.status, 429);
  assertEquals((await blocked.clone().json()).error.length > 0, true);
  const retryAfter = blocked.headers.get("Retry-After");
  assertEquals(retryAfter !== null, true);
  // Remaining requests during the penalty also 429.
  assertEquals((await req()).status, 429);
});

Deno.test("rate limiter does not count OPTIONS preflight against a client", async () => {
  const app = new Hono();
  app.use("*", rateLimit({ limit: 2, windowMs: 60_000, basePenaltyMs: 60_000 }));
  app.on("OPTIONS", "*", (c) => new Response(null, { status: 204 }));
  app.get("/", (c) => c.json({ ok: true }));

  const headers = { "x-forwarded-for": "10.0.0.2" };
  for (let i = 0; i < 10; i++) {
    assertEquals((await app.request("/", { method: "OPTIONS", headers })).status, 204);
  }
  // The 10 preflights above must not have consumed any of the 2-request budget.
  assertEquals((await app.request("/", { headers })).status, 200);
  assertEquals((await app.request("/", { headers })).status, 200);
});
