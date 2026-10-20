import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { MAX_WINDOW_SEC } from "../store/memory";
import type { Counters } from "../store/types";
import { withTimeout } from "./util";

/** The slice of the Upstash pipeline API we use, so tests can supply a fake. */
export interface RedisPipeline {
  zadd(key: string, entry: { score: number; member: string }): unknown;
  zremrangebyscore(key: string, min: number | string, max: number | string): unknown;
  zcount(key: string, min: number | string, max: number | string): unknown;
  expire(key: string, seconds: number): unknown;
  exec<T extends unknown[] = unknown[]>(): Promise<T>;
}
export interface RedisLike {
  pipeline(): RedisPipeline;
}

/**
 * Keys under this prefix (`gk:rl:{apiKeyId}`, the per-API-key rate limit) are trimmed to the requested window instead of
 * MAX_WINDOW_SEC; otherwise a busy key would keep 31 days of one-per-request members.
 */
const SHORT_LIVED_PREFIX = "gk:rl:";

/**
 * Sliding window over a sorted set: one member per event, scored by its timestamp in ms, so different windows
 * on the same key (24h ip velocity, 30d email reuse) are all answered by ZCOUNT over the same history.
 */
export class UpstashCounters implements Counters {
  constructor(
    private redis: RedisLike,
    private now: () => number = Date.now,
    private timeoutMs?: number,
  ) {}

  async hit(key: string, windowSec: number): Promise<number> {
    const now = this.now();
    const horizonSec = key.startsWith(SHORT_LIVED_PREFIX) ? windowSec : MAX_WINDOW_SEC;
    const p = this.redis.pipeline();
    p.zadd(key, { score: now, member: `${now}:${randomUUID()}` });
    p.zremrangebyscore(key, 0, now - horizonSec * 1000);
    // "(" makes the lower bound exclusive, matching MemoryCounters (t > cutoff).
    p.zcount(key, `(${now - windowSec * 1000}`, "+inf");
    p.expire(key, horizonSec);
    const res = await withTimeout(p.exec(), this.timeoutMs, "upstash");
    return Number(res[2]);
  }

  async count(key: string, windowSec: number): Promise<number> {
    const p = this.redis.pipeline();
    p.zcount(key, `(${this.now() - windowSec * 1000}`, "+inf");
    const res = await withTimeout(p.exec(), this.timeoutMs, "upstash");
    return Number(res[0]);
  }
}

export function createUpstashCounters(url: string, token: string): UpstashCounters {
  // retry: false, because a retry loop would outlast the 800ms budget; the engine degrades instead.
  return new UpstashCounters(new Redis({ url, token, retry: false }) as unknown as RedisLike);
}
