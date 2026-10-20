import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseStore, substringOrFilter, toCheck, toKey, toProject } from "./supabase";

// A recording stand-in for the Supabase query builder: every chained call is logged and the chain resolves to
// the canned response. Lets us assert that every query is scoped without a database.
type Call = [method: string, ...args: unknown[]];
function fakeClient(response: { data: unknown; error: { message: string } | null } = { data: [], error: null }) {
  const log: { table: string; calls: Call[] }[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const chain = (entry: { table: string; calls: Call[] }): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(response);
        return (...args: unknown[]) => {
          entry.calls.push([String(prop), ...args]);
          return chain(entry);
        };
      },
    });
  const client = {
    from(table: string) {
      const entry = { table, calls: [] as Call[] };
      log.push(entry);
      return chain(entry);
    },
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return Promise.resolve(response);
    },
  } as unknown as SupabaseClient;
  return { client, log, rpcs };
}

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some((c) => c[0] === method && args.every((a, i) => c[i + 1] === a));

const P = "11111111-1111-4111-8111-111111111111";
const projectRow = {
  id: P, owner_id: "owner-1", name: "n", credit_value_cents: 50, challenge_threshold: 40, block_threshold: 70,
  plan: "free", stripe_customer_id: null, stripe_subscription_id: null, created_at: "2026-01-02T03:04:05+00:00",
};

describe("SupabaseStore scoping", () => {
  it("scopes every project-level read and write by project_id", async () => {
    const row = {
      id: "1", project_id: P, created_at: "2026-01-01T00:00:00Z", email: "a@b.c", normalized_email: "a@b.c",
      email_domain: "b.c", decision: "allow", score: 1, latency_ms: 1, name: "n", prefix: "p", key_hash: "h",
    };
    const { client: c2, log: log2 } = fakeClient({ data: [row], error: null });
    const s2 = new SupabaseStore(c2);
    await s2.listKeys(P);
    await s2.listChecks(P, { before: "2026-01-02T00:00:00Z", decision: "block", search: "x" });
    await s2.revokeKey(P, "k1");
    const { client: c3, log: log3 } = fakeClient({ data: null, error: null });
    await new SupabaseStore(c3).getCheck(P, "c1");
    for (const entry of [...log2, ...log3]) {
      expect(has(entry.calls, "eq", "project_id", P), `${entry.table} query`).toBe(true);
    }
    expect(log2.map((e) => e.table)).toEqual(["api_keys", "checks", "api_keys"]);
  });

  it("scopes project lookups by id / owner", async () => {
    const { client, log } = fakeClient({ data: projectRow, error: null });
    const store = new SupabaseStore(client);
    await store.getProject(P);
    await store.listProjectsForOwner("owner-1").catch(() => {});
    await store.updateProject(P, { name: "x" });
    await store.setBilling(P, { plan: "pro" });
    expect(has(log[0].calls, "eq", "id", P)).toBe(true);
    expect(has(log[1].calls, "eq", "owner_id", "owner-1")).toBe(true);
    expect(has(log[2].calls, "eq", "id", P)).toBe(true);
    expect(has(log[3].calls, "eq", "id", P)).toBe(true);
  });

  it("passes the project id to every aggregate function", async () => {
    const { client, rpcs } = fakeClient({ data: [], error: null });
    const store = new SupabaseStore(client);
    await store.dailyStats(P, 14);
    await store.monthlyUsage(P);
    await store.topSignals(P, 7);
    expect(rpcs.map((r) => r.fn)).toEqual(["gatekeep_daily_stats", "gatekeep_monthly_usage", "gatekeep_top_signals"]);
    for (const r of rpcs) expect((r.args as { p_project_id: string }).p_project_id).toBe(P);
  });

  it("throws, with the operation named, when Supabase returns an error", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    const store = new SupabaseStore(client);
    await expect(store.listChecks(P)).rejects.toThrow("listChecks: boom");
    await expect(store.monthlyUsage(P)).rejects.toThrow("monthlyUsage: boom");
  });

  it("does not send an empty patch to the database", async () => {
    const { client, log } = fakeClient({ data: projectRow, error: null });
    await new SupabaseStore(client).updateProject(P, { name: undefined });
    expect(log.flatMap((e) => e.calls).some((c) => c[0] === "update")).toBe(false);
  });
});

describe("substringOrFilter", () => {
  it("builds a quoted, escaped ilike filter for each column", () => {
    expect(substringOrFilter(["email", "ip"], "maya")).toBe('email.ilike."%maya%",ip.ilike."%maya%"');
  });

  it("escapes LIKE wildcards and the escape character", () => {
    expect(substringOrFilter(["email"], "50%_off")).toBe('email.ilike."%50\\\\%\\\\_off%"');
    expect(substringOrFilter(["email"], "a\\b")).toBe('email.ilike."%a\\\\\\\\b%"');
  });

  it("keeps commas, parentheses and quotes inside the quoted value", () => {
    const f = substringOrFilter(["email"], 'a,b)(c"d');
    expect(f).toBe('email.ilike."%a,b)(c\\"d%"');
  });

  it("never lets a PostgREST wildcard asterisk through", () => {
    expect(substringOrFilter(["email"], "a*b")).not.toContain("*");
  });
});

describe("row mapping", () => {
  it("normalizes PostgREST timestamps to JS ISO strings and nulls", () => {
    const p = toProject({
      id: "p", owner_id: "o", name: "n", credit_value_cents: 50, challenge_threshold: 40, block_threshold: 70,
      plan: "free", stripe_customer_id: null, stripe_subscription_id: undefined, created_at: "2026-01-02T03:04:05.123456+00:00",
    });
    expect(p.created_at).toBe("2026-01-02T03:04:05.123Z");
    expect(p.stripe_subscription_id).toBeNull();
    const k = toKey({ id: "k", project_id: "p", name: "n", prefix: "x", key_hash: "h", created_at: "2026-01-02T03:04:05+00:00", last_used_at: null, revoked_at: "2026-01-03T00:00:00+00:00" });
    expect(k.last_used_at).toBeNull();
    expect(k.revoked_at).toBe("2026-01-03T00:00:00.000Z");
    const c = toCheck({
      id: "c", project_id: "p", created_at: "2026-01-02T03:04:05+00:00", email: "e", normalized_email: "e", email_domain: "d",
      ip: null, user_agent: null, device_id: null, decision: "allow", score: 1, reason: null, signals: null, latency_ms: 2,
    });
    expect(c.signals).toEqual([]);
    expect(c.reason).toBe("");
  });
});
