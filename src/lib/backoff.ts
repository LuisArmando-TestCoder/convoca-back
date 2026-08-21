// ── Exponential backoff retry ────────────────────────────────────────────────
// Shared by the Firestore client (retry 429/5xx) and available to any caller
// that talks to a quota-limited backend. Each retry waits
// baseDelayMs * factor^attempt, capped at maxDelayMs.

export interface BackoffOptions {
  /** Number of retries AFTER the initial attempt. Default 4. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** Retry only when this predicate says the error is retryable. Default: always. */
  shouldRetry?: (err: unknown) => boolean;
  /** Called before each retry with the 1-based attempt number and the delay. */
  onRetry?: (attempt: number, delayMs: number) => void;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const {
    retries = 4,
    baseDelayMs = 250,
    maxDelayMs = 8000,
    factor = 2,
    shouldRetry = () => true,
    onRetry,
  } = opts;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attempt));
      attempt++;
      onRetry?.(attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}