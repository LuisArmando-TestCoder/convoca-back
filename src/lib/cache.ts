// ── Layered cache with smart queuing ──────────────────────────────────────────
// A small in-memory read cache for Firestore documents and collection listings.
// Three layers work together to absorb quota spikes:
//
//   1. Fresh TTL      — a hit younger than `freshMs` returns instantly.
//   2. Stale-while-revalidate — an expired-but-present value is returned
//                        immediately while ONE background refresh repopulates it.
//   3. Single-flight   — concurrent misses for the same key share one fetch
//                        instead of stampeding the backend.
//
// Writes (fsSet/fsCreate/fsCasUpdate/fsDelete) invalidate the affected key and
// are serialized through a per-key queue so a burst of writes to the same
// document applies in order instead of racing.

export interface CacheOptions {
  /** How long a value is considered fresh (ms). Default 30s. */
  freshMs?: number;
  /** How long a stale value may still be served (ms). Default 5min. */
  staleMs?: number;
  /** Max entries before the oldest are evicted. Default 10_000. */
  maxEntries?: number;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class LayeredCache {
  private readonly freshMs: number;
  private readonly staleMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(opts: CacheOptions = {}) {
    this.freshMs = opts.freshMs ?? 30_000;
    this.staleMs = opts.staleMs ?? 300_000;
    this.maxEntries = opts.maxEntries ?? 10_000;
  }

  /** Reads through the cache. `loader` runs at most once per key at a time. */
  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key) as Entry<T> | undefined;

    if (hit) {
      const age = now - hit.fetchedAt;
      if (age <= this.freshMs) return hit.value;
      if (age <= this.freshMs + this.staleMs) {
        // Serve stale now, refresh in the background (single-flight).
        this.refreshInBackground(key, loader);
        return hit.value;
      }
      // Too old to serve: fall through to a fresh fetch.
    }

    return this.singleFlight(key, loader);
  }

  /** Forces a fresh fetch, bypassing any cached value. */
  async getFresh<T>(key: string, loader: () => Promise<T>): Promise<T> {
    return this.singleFlight(key, loader);
  }

  /** Puts a value directly (used by write paths to warm the cache). */
  set<T>(key: string, value: T): void {
    this.evictIfNeeded();
    this.store.set(key, { value, fetchedAt: Date.now() });
  }

  /** Drops a key (and any queued writes for it are unaffected). */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Serializes a write per key so same-doc writes apply in order. */
  async enqueueWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(key) ?? Promise.resolve();
    const next = prev.then(write, write);
    // Keep the chain alive but drop the result so a rejection doesn't poison
    // the next write in the queue.
    this.writeQueues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await next;
    } finally {
      if (this.writeQueues.get(key) === next) this.writeQueues.delete(key);
    }
  }

  private async singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      try {
        const value = await loader();
        this.evictIfNeeded();
        this.store.set(key, { value, fetchedAt: Date.now() });
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  private refreshInBackground<T>(key: string, loader: () => Promise<T>): void {
    if (this.inflight.has(key)) return;
    this.singleFlight(key, loader).catch(() => {
      // Keep the stale value; a later request will retry the refresh.
    });
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = this.store.keys().next().value;
    if (oldest !== undefined) this.store.delete(oldest);
  }
}