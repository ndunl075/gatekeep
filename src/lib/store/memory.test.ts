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
    expect(stats.every((d) => d.allow + d.challenge + d.block === 0)).toBe(true);
  });

  it("demo store has data and a working demo key", async () => {
    const s = createDemoStore();
    expect((await s.findKeyByHash(hashKey(DEMO_API_KEY)))?.project_id).toBe(DEMO_PROJECT_ID);
    const stats = await s.dailyStats(DEMO_PROJECT_ID, 14);
    expect(stats.reduce((n, d) => n + d.block, 0)).toBeGreaterThan(50);
  });
});

describe("readKeyFromHeaders", () => {
  it("reads bearer and x-api-key", () => {
    expect(readKeyFromHeaders(new Headers({ authorization: "Bearer gk_live_x" }))).toBe("gk_live_x");
    expect(readKeyFromHeaders(new Headers({ "x-api-key": "gk_live_y" }))).toBe("gk_live_y");
    expect(readKeyFromHeaders(new Headers())).toBeNull();
  });
});
