import "server-only";

/**
 * Fixed-window rate limiter.
 *
 * PROTOTYPE LIMITATION: this store is in-process memory, so limits are per
 * application instance. Before running more than one instance, replace the
 * store with Redis (see docs/ARCHITECTURE.md §Rate limiting). Account lockout
 * in the database remains the authoritative brute-force control.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<number>;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (this.buckets.size > 50_000) this.sweep(now);
      return 1;
    }
    b.count += 1;
    return b.count;
  }
  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

const globalStore = globalThis as unknown as { __itmRateLimit?: RateLimitStore };
const store: RateLimitStore = (globalStore.__itmRateLimit ??= new MemoryStore());

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const count = await store.hit(key, windowMs);
  return count <= limit;
}
