import { describe, expect, it } from "vitest";
import { MemoryCounters, MemoryStore } from "./memory";
import { createDemoStore, DEMO_API_KEY, DEMO_PROJECT_ID } from "../demo";
import { generateKey, hashKey, readKeyFromHeaders } from "../keys";

describe("MemoryCounters", () => {
  it("counts events inside the window", async () => {
    let now = 1_000_000;
    const c = new MemoryCounters(() => now);
    expect(await c.hit("ip:1", 60)).toBe(1);
    expect(await c.hit("ip:1", 60)).toBe(2);
    now += 61_000;
    expect(await c.count("ip:1", 60)).toBe(0);
    expect(await c.count("ip:1", 3600)).toBe(2);
    expect(await c.hit("ip:1", 60)).toBe(1);
  });

  it("supports 30 day windows", async () => {
    let now = 0;
    const c = new MemoryCounters(() => now);
    await c.hit("em:a", 30 * 86_400);
    now += 20 * 86_400_000;
    expect(await c.hit("em:a", 30 * 86_400)).toBe(2);
    now += 11 * 86_400_000;
    expect(await c.count("em:a", 30 * 86_400)).toBe(1);
  });
});

describe("MemoryStore", () => {
  it("creates projects, keys and stats", async () => {
    const s = new MemoryStore();
    const p = await s.createProject("u1", "App");
    const { plaintext, key } = generateKey(p.id, "default");
    await s.insertKey(key);
    expect((await s.findKeyByHash(hashKey(plaintext)))?.id).toBe(key.id);
    await s.revokeKey(p.id, key.id);
    expect(await s.findKeyByHash(hashKey(plaintext))).toBeNull();
    const stats = await s.dailyStats(p.id, 14);
    expect(stats).toHaveLength(14);
    expect(stats.every((d) => d.allow + d.challenge + d.block === 0)).toBe(
      true,
    );
  });

  it("demo store has data and a working demo key", async () => {
    const s = createDemoStore();
    expect((await s.findKeyByHash(hashKey(DEMO_API_KEY)))?.project_id).toBe(
      DEMO_PROJECT_ID,
    );
    const stats = await s.dailyStats(DEMO_PROJECT_ID, 14);
    expect(stats.reduce((n, d) => n + d.block, 0)).toBeGreaterThan(50);
    const top = await s.topSignals(DEMO_PROJECT_ID, 7);
    expect(top[0].count).toBeGreaterThanOrEqual(top[top.length - 1].count);
    expect(top.map((t) => t.id)).toContain("disposable_domain");
  });
});

describe("MemoryStore queries", () => {
  it("filters, searches, pages and counts the month", async () => {
    const s = new MemoryStore();
    const p = await s.createProject("u1", "App");
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await s.insertCheck({
        id: `c${i}`,
        project_id: p.id,
        created_at: new Date(base - i * 1000).toISOString(),
        email: `User${i}@x.com`,
        normalized_email: `user${i}@x.com`,
        email_domain: "x.com",
        ip: i % 2 ? "10.0.0.1" : "2001:DB8::1",
        user_agent: null,
        device_id: null,
        decision: i % 2 ? "block" : "allow",
        score: i,
        reason: "",
        signals: [],
        latency_ms: 1,
      });
    }
    expect(
      (await s.listChecks(p.id, { decision: "block" })).map((c) => c.id),
    ).toEqual(["c1", "c3"]);
    expect(
      (await s.listChecks(p.id, { search: "user2" })).map((c) => c.id),
    ).toEqual(["c2"]);
    expect((await s.listChecks(p.id, { search: "2001:db8" })).length).toBe(3);
    const first = await s.listChecks(p.id, { limit: 2 });
    const next = await s.listChecks(p.id, {
      limit: 2,
      before: first[1].created_at,
    });
    expect(next.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(await s.monthlyUsage(p.id)).toBeGreaterThanOrEqual(1);
    const stats = await s.dailyStats(p.id, 3);
    expect(stats[2].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("ignores undefined fields in patches", async () => {
    const s = new MemoryStore();
    const p = await s.createProject("u1", "App");
    const next = await s.updateProject(p.id, {
      name: undefined,
      block_threshold: 80,
    });
    expect(next.name).toBe("App");
    expect(next.block_threshold).toBe(80);
  });
});

describe("generateKey", () => {
  it("makes unique gk_live_ keys with a display prefix", () => {
    const a = generateKey("p", "a");
    const b = generateKey("p", "b");
    expect(a.plaintext).toMatch(/^gk_live_[0-9A-Za-z]{40}$/);
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.key.prefix).toBe(a.plaintext.slice(0, 12));
    expect(a.key.key_hash).toBe(hashKey(a.plaintext));
  });
});

describe("readKeyFromHeaders", () => {
  it("reads bearer and x-api-key", () => {
    expect(
      readKeyFromHeaders(new Headers({ authorization: "Bearer gk_live_x" })),
    ).toBe("gk_live_x");
    expect(readKeyFromHeaders(new Headers({ "x-api-key": "gk_live_y" }))).toBe(
      "gk_live_y",
    );
    expect(readKeyFromHeaders(new Headers())).toBeNull();
  });
});
