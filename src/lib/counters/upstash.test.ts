import { describe, expect, it } from "vitest";
import { MAX_WINDOW_SEC } from "../store/memory";
import { UpstashCounters, type RedisLike } from "./upstash";

/** Just enough Redis sorted-set semantics for the commands the counters use. */
class FakeRedis implements RedisLike {
  zsets = new Map<string, { score: number; member: string }[]>();
  ttl = new Map<string, number>();
  log: string[] = [];
  pipelines = 0;
  fail: Error | null = null;
  hang = false;

  pipeline() {
    this.pipelines++;
    const ops: (() => unknown)[] = [];
    const bound = (s: string) => parseFloat(s.replace("(", ""));
    const p = {
      zadd: (key: string, e: { score: number; member: string }) => {
        ops.push(() => {
          this.log.push("zadd");
          const l = this.zsets.get(key) ?? [];
          l.push(e);
          this.zsets.set(key, l);
          return 1;
        });
        return p;
      },
      zremrangebyscore: (key: string, min: number | string, max: number | string) => {
        ops.push(() => {
          this.log.push(`zrem ${min}..${max}`);
          this.zsets.set(
            key,
            (this.zsets.get(key) ?? []).filter((e) => e.score < Number(min) || e.score > Number(max)),
          );
          return 0;
        });
        return p;
      },
      zcount: (key: string, min: number | string, max: number | string) => {
        ops.push(() => {
          this.log.push(`zcount ${min}..${max}`);
          const exclusive = typeof min === "string" && min.startsWith("(");
          const lo = bound(String(min));
          return (this.zsets.get(key) ?? []).filter(
            (e) => (exclusive ? e.score > lo : e.score >= lo) && (max === "+inf" || e.score <= Number(max)),
          ).length;
        });
        return p;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.log.push("expire");
          this.ttl.set(key, seconds);
          return 1;
        });
        return p;
      },
      exec: async () => {
        if (this.hang) return new Promise<never>(() => {});
        if (this.fail) throw this.fail;
        return ops.map((o) => o());
      },
    };
    return p as unknown as ReturnType<RedisLike["pipeline"]>;
  }
}

function setup() {
  let t = 1_700_000_000_000;
  const redis = new FakeRedis();
  const counters = new UpstashCounters(redis, () => t, 50);
  return { redis, counters, advance: (sec: number) => (t += sec * 1000) };
}

describe("UpstashCounters", () => {
  it("hit returns the count including itself, in one pipeline", async () => {
    const { redis, counters } = setup();
    expect(await counters.hit("gk:p:ip:1.2.3.4", 86_400)).toBe(1);
    expect(await counters.hit("gk:p:ip:1.2.3.4", 86_400)).toBe(2);
    expect(redis.pipelines).toBe(2);
    expect(redis.log.slice(0, 4)).toEqual(["zadd", `zrem 0..${1_700_000_000_000 - MAX_WINDOW_SEC * 1000}`, expect.stringMatching(/^zcount \(/), "expire"]);
    expect(redis.ttl.get("gk:p:ip:1.2.3.4")).toBe(MAX_WINDOW_SEC);
  });

  it("count does not add", async () => {
    const { counters } = setup();
    await counters.hit("k", 60);
    expect(await counters.count("k", 60)).toBe(1);
    expect(await counters.count("k", 60)).toBe(1);
    expect(await counters.count("never", 60)).toBe(0);
  });

  it("keeps per-event history so different windows on one key work", async () => {
    const { counters, advance } = setup();
    await counters.hit("k", 600);
    advance(700);
    await counters.hit("k", 600);
    expect(await counters.count("k", 600)).toBe(1);
    expect(await counters.count("k", 86_400)).toBe(2);
    advance(86_400);
    expect(await counters.count("k", 86_400)).toBe(0);
    expect(await counters.count("k", MAX_WINDOW_SEC)).toBe(2);
  });

  it("window edge is exclusive, like MemoryCounters", async () => {
    const { counters, advance } = setup();
    await counters.hit("k", 60);
    advance(60);
    expect(await counters.count("k", 60)).toBe(0);
  });

  it("forgets events older than MAX_WINDOW_SEC", async () => {
    const { counters, advance, redis } = setup();
    await counters.hit("k", 60);
    advance(MAX_WINDOW_SEC + 1);
    await counters.hit("k", MAX_WINDOW_SEC);
    expect(redis.zsets.get("k")).toHaveLength(1);
  });

  it("events in the same millisecond are distinct members", async () => {
    const { counters } = setup();
    await Promise.all([counters.hit("k", 60), counters.hit("k", 60), counters.hit("k", 60)]);
    expect(await counters.count("k", 60)).toBe(3);
  });

  it("rate limit keys are trimmed to their own window", async () => {
    const { counters, redis } = setup();
    await counters.hit("gk:rl:abc", 60);
    expect(redis.ttl.get("gk:rl:abc")).toBe(60);
  });

  it("rejects on redis errors", async () => {
    const { counters, redis } = setup();
    redis.fail = new Error("boom");
    await expect(counters.hit("k", 60)).rejects.toThrow("boom");
    await expect(counters.count("k", 60)).rejects.toThrow("boom");
  });

  it("rejects instead of hanging", async () => {
    const { counters, redis } = setup();
    redis.hang = true;
    await expect(counters.hit("k", 60)).rejects.toThrow(/timed out/);
    await expect(counters.count("k", 60)).rejects.toThrow(/timed out/);
  });
});
