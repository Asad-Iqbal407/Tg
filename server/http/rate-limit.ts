export interface RateLimitOptions {
  /** Attempts allowed per key in one window. The attempt after the limit is refused. */
  limit: number;
  windowMs: number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, now: number): RateDecision;
}

/** Above this many tracked keys, expired windows are dropped so memory stays bounded. */
const SWEEP_THRESHOLD = 10_000;

/**
 * Fixed-window counter in process memory. Every instance keeps its own counts, so with several
 * replicas each one allows the full limit. A shared store (Redis or a database collection) would be
 * needed to make the limit global.
 */
export function createRateLimiter({ limit, windowMs }: RateLimitOptions): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number): void {
    for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
  }

  return {
    hit(key, now) {
      if (windows.size > SWEEP_THRESHOLD) sweep(now);
      let window = windows.get(key);
      if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
    },
  };
}
