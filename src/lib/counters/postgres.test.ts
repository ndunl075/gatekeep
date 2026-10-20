import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PostgresCounters, parseKey } from "./postgres";

describe("parseKey", () => {
  it("parses each key scheme", () => {
    expect(parseKey("gk:p1:ip:1.2.3.4")).toEqual({ projectId: "p1", column: "ip", value: "1.2.3.4" });
    expect(parseKey("gk:p1:dev:abc-123")).toEqual({ projectId: "p1", column: "device_id", value: "abc-123" });
    expect(parseKey("gk:p1:em:maya@gmail.com")).toEqual({ projectId: "p1", column: "normalized_email", value: "maya@gmail.com" });
    expect(parseKey("gk:p1:burst")).toEqual({ projectId: "p1", column: null });
  });
  it("keeps colons in the value (IPv6)", () => {
    expect(parseKey("gk:p1:ip:2001:db8::1")).toEqual({ projectId: "p1", column: "ip", value: "2001:db8::1" });
  });
  it("rejects anything else", () => {
    for (const k of ["gk:rl:abc", "gk:p1:other:x", "ip:1.2.3.4", "gk:p1:burst:x", ""]) {
      // "gk:rl:abc" has no scheme segment, so it must not be mistaken for a project key.
      expect(parseKey(k)).toBeNull();
    }
  });
});

/** Records the filters applied and resolves to a canned count. */
function fakeClient(result: { count: number | null; error?: { message: string } | null } | "hang") {
  const calls: { table?: string; select?: unknown; eq: [string, unknown][]; gt: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, eq: [] as [string, unknown][], gt: [] as [string, unknown][], select: undefined as unknown };
      calls.push(call);
      const q: Record<string, unknown> = {
        select: (...a: unknown[]) => ((call.select = a), q),
        eq: (c: string, v: unknown) => (call.eq.push([c, v]), q),
        gt: (c: string, v: unknown) => (call.gt.push([c, v]), q),
        abortSignal: () => q,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          (result === "hang" ? new Promise(() => {}) : Promise.resolve({ error: null, ...result })).then(res, rej),
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("PostgresCounters", () => {
  const NOW = Date.parse("2026-03-01T12:00:00Z");

  it("count filters by project, column and window", async () => {
    const { client, calls } = fakeClient({ count: 4 });
    const c = new PostgresCounters(client, () => NOW);
    expect(await c.count("gk:p1:ip:1.2.3.4", 86_400)).toBe(4);
    expect(calls[0].table).toBe("checks");
    expect(calls[0].eq).toEqual([
      ["project_id", "p1"],
      ["ip", "1.2.3.4"],
    ]);
    expect(calls[0].gt).toEqual([["created_at", "2026-02-28T12:00:00.000Z"]]);
  });

  it("hit is count + 1 (the current check is inserted afterwards)", async () => {
    const { client } = fakeClient({ count: 2 });
    expect(await new PostgresCounters(client, () => NOW).hit("gk:p1:em:a@b.co", 60)).toBe(3);
  });

  it("burst counts the whole project; wide windows are cached for a minute", async () => {
    const { client, calls } = fakeClient({ count: 7 });
    let t = NOW;
    const c = new PostgresCounters(client, () => t);
    expect(await c.count("gk:p1:burst", 86_400)).toBe(7);
    expect(calls[0].eq).toEqual([["project_id", "p1"]]);
    await c.count("gk:p1:burst", 86_400);
    expect(calls).toHaveLength(1);
    t += 61_000;
    await c.count("gk:p1:burst", 86_400);
    expect(calls).toHaveLength(2);
    // The 10 minute window is never cached.
    await c.count("gk:p1:burst", 600);
    await c.count("gk:p1:burst", 600);
    expect(calls).toHaveLength(4);
  });

  it("rejects on database errors, unsupported keys and timeouts", async () => {
    await expect(new PostgresCounters(fakeClient({ count: null, error: { message: "down" } }).client).count("gk:p:burst", 60)).rejects.toThrow("down");
    await expect(new PostgresCounters(fakeClient({ count: 1 }).client).hit("gk:rl:x", 60)).rejects.toThrow(/do not support/);
    await expect(new PostgresCounters(fakeClient("hang").client, Date.now, 20).count("gk:p:burst", 60)).rejects.toThrow(/timed out/);
  });
});
