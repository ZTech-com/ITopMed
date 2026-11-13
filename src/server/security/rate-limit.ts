import "server-only";
import { withAppContext } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { sha256Hex } from "./crypto";

/**
 * Fixed-window rate limiter.
 *
 *  - database (default): counters live in PostgreSQL (UNLOGGED table,
 *    atomic rate_limit_hit()), so limits hold across every app instance.
 *    Keys are SHA-256 hashed before they leave the process.
 *  - memory: per-process counters, for special set-ups only.
 *
 * Fails CLOSED: if the store cannot be reached the attempt is refused.
 * Account lockout in the database remains the authoritative brute-force control.
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

class DatabaseStore implements RateLimitStore {
  async hit(key: string, windowMs: number) {
    const rows = await withAppContext({}, (tx) => tx.$queryRaw<{ count: number }[]>`SELECT rate_limit_hit(${sha256Hex(key)}, ${windowMs}::int) AS count`);
    return Number(rows[0]?.count ?? Number.MAX_SAFE_INTEGER);
  }
}

const g = globalThis as unknown as { __itmRateLimit?: RateLimitStore };
function store(): RateLimitStore {
  return (g.__itmRateLimit ??= env().RATE_LIMIT_STORE === "memory" ? new MemoryStore() : new DatabaseStore());
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    return (await store().hit(key, windowMs)) <= limit;
  } catch (e) {
    logger.error("rate_limit.store_failed", { error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}
