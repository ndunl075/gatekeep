import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiKey, CheckLog, Decision, Signal } from "../types";
import type { Store } from "./types";

// A behavior suite every Store implementation must pass. Run it from a *.conformance.test.ts file.
// It only ever creates its own owners/projects, so it can share a database with other data (use a test project).

export interface ConformanceHarness {
  store: Store;
  /** A fresh owner id. For Supabase this creates an auth user (projects.owner_id references auth.users). */
  newOwnerId(): Promise<string>;
  cleanup?(): Promise<void>;
}

const DAY_MS = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const at = (offset: number, time = "12:00:00.000Z") => `${utcDay(offset)}T${time}`;

let seq = 0;
function makeCheck(projectId: string, over: Partial<CheckLog> = {}): CheckLog {
  seq++;
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    created_at: new Date().toISOString(),
    email: `user${seq}@example.com`,
    normalized_email: `user${seq}@example.com`,
    email_domain: "example.com",
    ip: "203.0.113.7",
    user_agent: "Mozilla/5.0",
    device_id: "dev-1",
    decision: "allow",
    score: 5,
    reason: "looks fine",
    signals: [],
    latency_ms: 12,
    ...over,
  };
}

const sig = (id: Signal["id"], points = 10): Signal => ({ id, points, detail: `${id} fired` });

function makeKey(projectId: string, over: Partial<ApiKey> = {}): ApiKey {
  const id = crypto.randomUUID();
  return {
    id,
    project_id: projectId,
    name: "default",
    prefix: "gk_live_ab12",
    key_hash: `hash-${id}`,
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    ...over,
  };
}

export function runStoreConformance(name: string, setup: () => Promise<ConformanceHarness>) {
  describe(`Store conformance: ${name}`, () => {
    let h: ConformanceHarness;
    let store: Store;
    beforeAll(async () => {
      h = await setup();
      store = h.store;
    });
    afterAll(async () => {
      await h?.cleanup?.();
    });

    async function newProject(label = "App") {
      const owner = await h.newOwnerId();
      return store.createProject(owner, label);
    }

    describe("projects", () => {
      it("creates a project with the documented defaults and reads it back", async () => {
        const owner = await h.newOwnerId();
        const p = await store.createProject(owner, "My app");
        expect(p).toMatchObject({
          owner_id: owner,
          name: "My app",
          credit_value_cents: 50,
          challenge_threshold: 40,
          block_threshold: 70,
          plan: "free",
          stripe_customer_id: null,
          stripe_subscription_id: null,
        });
        expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(new Date(p.created_at).toISOString()).toBe(p.created_at);
        expect(await store.getProject(p.id)).toEqual(p);
      });

      it("returns null for an unknown project", async () => {
        expect(await store.getProject(crypto.randomUUID())).toBeNull();
      });

      it("lists only the owner's projects, oldest first", async () => {
        const owner = await h.newOwnerId();
        const other = await h.newOwnerId();
        const a = await store.createProject(owner, "first");
        await new Promise((r) => setTimeout(r, 5));
        const b = await store.createProject(owner, "second");
        await store.createProject(other, "not mine");
        expect((await store.listProjectsForOwner(owner)).map((p) => p.id)).toEqual([a.id, b.id]);
        expect(await store.listProjectsForOwner(await h.newOwnerId())).toEqual([]);
      });

      it("updates only the fields given", async () => {
        const p = await newProject("Before");
        const next = await store.updateProject(p.id, { name: "After", credit_value_cents: 125 });
        expect(next).toMatchObject({ name: "After", credit_value_cents: 125, challenge_threshold: 40, block_threshold: 70 });
        const again = await store.updateProject(p.id, { name: undefined, block_threshold: 80, challenge_threshold: 30 });
        expect(again).toMatchObject({ name: "After", credit_value_cents: 125, challenge_threshold: 30, block_threshold: 80 });
        expect(await store.updateProject(p.id, {})).toEqual(again);
        expect(await store.getProject(p.id)).toEqual(again);
      });

      it("rejects updates to a project that does not exist", async () => {
        await expect(store.updateProject(crypto.randomUUID(), { name: "x" })).rejects.toThrow();
        await expect(store.setBilling(crypto.randomUUID(), { plan: "pro" })).rejects.toThrow();
      });

      it("sets billing, leaves unspecified ids alone, and clears with null", async () => {
        const p = await newProject();
        const customer = `cus_${crypto.randomUUID()}`;
        const pro = await store.setBilling(p.id, { plan: "pro", stripe_customer_id: customer, stripe_subscription_id: "sub_1" });
        expect(pro).toMatchObject({ plan: "pro", stripe_customer_id: customer, stripe_subscription_id: "sub_1" });
        const scale = await store.setBilling(p.id, { plan: "scale" });
        expect(scale).toMatchObject({ plan: "scale", stripe_customer_id: customer, stripe_subscription_id: "sub_1" });
        expect((await store.getProjectByStripeCustomer(customer))?.id).toBe(p.id);
        const free = await store.setBilling(p.id, { plan: "free", stripe_subscription_id: null });
        expect(free).toMatchObject({ plan: "free", stripe_customer_id: customer, stripe_subscription_id: null });
        expect(await store.getProjectByStripeCustomer(`cus_${crypto.randomUUID()}`)).toBeNull();
      });
    });

    describe("api keys", () => {
      it("finds an active key by hash and returns every field", async () => {
        const p = await newProject();
        const key = makeKey(p.id, { name: "prod" });
        await store.insertKey(key);
        expect(await store.findKeyByHash(key.key_hash)).toEqual(key);
        expect(await store.findKeyByHash("no-such-hash")).toBeNull();
      });

      it("revoking hides the key from lookup but keeps it listed", async () => {
        const p = await newProject();
        const key = makeKey(p.id);
        await store.insertKey(key);
        await store.revokeKey(p.id, key.id);
        expect(await store.findKeyByHash(key.key_hash)).toBeNull();
        const [listed] = await store.listKeys(p.id);
        expect(listed.id).toBe(key.id);
        expect(listed.revoked_at).not.toBeNull();
      });

      it("only revokes within the given project", async () => {
        const mine = await newProject();
        const theirs = await newProject();
        const key = makeKey(theirs.id);
        await store.insertKey(key);
        await store.revokeKey(mine.id, key.id);
        expect((await store.findKeyByHash(key.key_hash))?.id).toBe(key.id);
        await store.revokeKey(mine.id, crypto.randomUUID()); // unknown key: no-op, no throw
      });

      it("keeps the first revocation time when revoked twice", async () => {
        const p = await newProject();
        const key = makeKey(p.id);
        await store.insertKey(key);
        await store.revokeKey(p.id, key.id);
        const first = (await store.listKeys(p.id))[0].revoked_at;
        await new Promise((r) => setTimeout(r, 5));
        await store.revokeKey(p.id, key.id);
        expect((await store.listKeys(p.id))[0].revoked_at).toBe(first);
      });

      it("lists keys newest first and scoped to the project", async () => {
        const p = await newProject();
        const other = await newProject();
        const older = makeKey(p.id, { created_at: at(-2) });
        const newer = makeKey(p.id, { created_at: at(-1) });
        await store.insertKey(older);
        await store.insertKey(newer);
        await store.insertKey(makeKey(other.id));
        expect((await store.listKeys(p.id)).map((k) => k.id)).toEqual([newer.id, older.id]);
      });

      it("touchKey sets last_used_at", async () => {
        const p = await newProject();
        const key = makeKey(p.id);
        await store.insertKey(key);
        await store.touchKey(key.id);
        const found = await store.findKeyByHash(key.key_hash);
        expect(found?.last_used_at).not.toBeNull();
        expect(Math.abs(Date.now() - new Date(found!.last_used_at!).getTime())).toBeLessThan(60_000);
        await store.touchKey(crypto.randomUUID()); // unknown key: no-op
      });

      it("refuses a duplicate key hash", async () => {
        const p = await newProject();
        const key = makeKey(p.id);
        await store.insertKey(key);
        await expect(store.insertKey(makeKey(p.id, { key_hash: key.key_hash }))).rejects.toThrow();
      });
    });

    describe("checks", () => {
      it("round-trips a check, including nulls and signals", async () => {
        const p = await newProject();
        const full = makeCheck(p.id, {
          decision: "block",
          score: 92,
          signals: [sig("disposable_domain", 80), sig("plus_alias")],
          ip: "2001:db8::1",
        });
        const bare = makeCheck(p.id, { ip: null, user_agent: null, device_id: null, reason: "" });
        await store.insertCheck(full);
        await store.insertCheck(bare);
        expect(await store.getCheck(p.id, full.id)).toEqual(full);
        expect(await store.getCheck(p.id, bare.id)).toEqual(bare);
        expect(await store.getCheck(p.id, crypto.randomUUID())).toBeNull();
      });

      it("never returns a check through another project", async () => {
        const mine = await newProject();
        const theirs = await newProject();
        const c = makeCheck(theirs.id);
        await store.insertCheck(c);
        expect(await store.getCheck(mine.id, c.id)).toBeNull();
        expect(await store.listChecks(mine.id)).toEqual([]);
        expect((await store.listChecks(theirs.id)).map((x) => x.id)).toEqual([c.id]);
      });

      it("refuses a duplicate check id", async () => {
        const p = await newProject();
        const c = makeCheck(p.id);
        await store.insertCheck(c);
        await expect(store.insertCheck(c)).rejects.toThrow();
      });

      it("lists newest first, honors limit, and pages with before", async () => {
        const p = await newProject();
        const base = Date.now() - 10 * 60_000;
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const c = makeCheck(p.id, { created_at: new Date(base + i * 1000).toISOString() });
          ids.push(c.id);
          await store.insertCheck(c);
        }
        const newestFirst = [...ids].reverse();
        expect((await store.listChecks(p.id)).map((c) => c.id)).toEqual(newestFirst);
        const page1 = await store.listChecks(p.id, { limit: 2 });
        expect(page1.map((c) => c.id)).toEqual(newestFirst.slice(0, 2));
        const page2 = await store.listChecks(p.id, { limit: 2, before: page1[1].created_at });
        expect(page2.map((c) => c.id)).toEqual(newestFirst.slice(2, 4));
        const page3 = await store.listChecks(p.id, { limit: 2, before: page2[1].created_at });
        expect(page3.map((c) => c.id)).toEqual(newestFirst.slice(4));
      });

      it("filters by decision", async () => {
        const p = await newProject();
        const decisions: Decision[] = ["allow", "block", "challenge", "block"];
        const made = decisions.map((decision, i) => makeCheck(p.id, { decision, created_at: new Date(Date.now() - (10 - i) * 1000).toISOString() }));
        for (const c of made) await store.insertCheck(c);
        expect((await store.listChecks(p.id, { decision: "block" })).map((c) => c.id)).toEqual([made[3].id, made[1].id]);
        expect((await store.listChecks(p.id, { decision: "challenge" })).map((c) => c.id)).toEqual([made[2].id]);
      });

      it("searches email and ip case-insensitively", async () => {
        const p = await newProject();
        const a = makeCheck(p.id, { email: "Maya.Chen@Example.com", ip: "198.51.100.4" });
        const b = makeCheck(p.id, { email: "other@example.com", ip: "2001:DB8::Abcd" });
        await store.insertCheck(a);
        await store.insertCheck(b);
        const ids = async (search: string) => (await store.listChecks(p.id, { search })).map((c) => c.id).sort();
        expect(await ids("maya.chen")).toEqual([a.id]);
        expect(await ids("EXAMPLE.COM")).toEqual([a.id, b.id].sort());
        expect(await ids("198.51")).toEqual([a.id]);
        expect(await ids("2001:db8::abcd")).toEqual([b.id]);
        expect(await ids("nothing-matches")).toEqual([]);
        expect((await store.listChecks(p.id, { search: "   " })).length).toBe(2);
      });

      it("treats search input as a literal substring", async () => {
        const p = await newProject();
        const emails = ["pct%x@e.com", "pctQx@e.com", "und_x@e.com", "undQx@e.com", "back\\slash@e.com", "comma,paren(1)@e.com", 'quo"te@e.com', "dot.dot@e.com", "star*x@e.com"];
        const made = emails.map((email) => makeCheck(p.id, { email }));
        for (const c of made) await store.insertCheck(c);
        const found = async (search: string) => (await store.listChecks(p.id, { search })).map((c) => c.email).sort();
        expect(await found("pct%x")).toEqual(["pct%x@e.com"]);
        expect(await found("%")).toEqual(["pct%x@e.com"]);
        expect(await found("und_x")).toEqual(["und_x@e.com"]);
        expect(await found("_")).toEqual(["und_x@e.com"]);
        expect(await found("back\\slash")).toEqual(["back\\slash@e.com"]);
        expect(await found("comma,paren(1)")).toEqual(["comma,paren(1)@e.com"]);
        expect(await found('quo"te')).toEqual(['quo"te@e.com']);
        expect(await found("dot.dot")).toEqual(["dot.dot@e.com"]);
        expect(await found("),email.eq.x")).toEqual([]);
        expect(await found("star*x")).toContain("star*x@e.com");
      });

      it("combines search, decision and before", async () => {
        const p = await newProject();
        const old = makeCheck(p.id, { email: "combo@e.com", decision: "block", created_at: new Date(Date.now() - 5000).toISOString() });
        const recent = makeCheck(p.id, { email: "combo2@e.com", decision: "block", created_at: new Date(Date.now() - 1000).toISOString() });
        const wrongDecision = makeCheck(p.id, { email: "combo3@e.com", decision: "allow", created_at: new Date(Date.now() - 6000).toISOString() });
        for (const c of [old, recent, wrongDecision]) await store.insertCheck(c);
        const res = await store.listChecks(p.id, { search: "combo", decision: "block", before: recent.created_at });
        expect(res.map((c) => c.id)).toEqual([old.id]);
      });
    });

    describe("stats", () => {
      it("zero-fills daily stats per UTC day, oldest first, scoped to the project", async () => {
        const p = await newProject();
        const other = await newProject();
        await store.insertCheck(makeCheck(p.id, { decision: "allow", created_at: at(0, "00:00:00.000Z") }));
        await store.insertCheck(makeCheck(p.id, { decision: "block", created_at: at(0, "23:59:59.999Z") }));
        await store.insertCheck(makeCheck(p.id, { decision: "challenge", created_at: at(-2) }));
        await store.insertCheck(makeCheck(p.id, { decision: "allow", created_at: at(-2) }));
        await store.insertCheck(makeCheck(p.id, { decision: "allow", created_at: at(-9) })); // outside a 4 day window
        await store.insertCheck(makeCheck(other.id, { decision: "block", created_at: at(0) }));
        const stats = await store.dailyStats(p.id, 4);
        expect(stats.map((s) => s.date)).toEqual([utcDay(-3), utcDay(-2), utcDay(-1), utcDay(0)]);
        expect(stats.map((s) => [s.allow, s.challenge, s.block])).toEqual([
          [0, 0, 0],
          [1, 1, 0],
          [0, 0, 0],
          [1, 0, 1],
        ]);
        const empty = await store.dailyStats((await newProject()).id, 3);
        expect(empty).toHaveLength(3);
        expect(empty.every((s) => s.allow + s.challenge + s.block === 0)).toBe(true);
      });

      it("counts this UTC month only, scoped to the project", async () => {
        const p = await newProject();
        const other = await newProject();
        const now = new Date();
        const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
        expect(await store.monthlyUsage(p.id)).toBe(0);
        await store.insertCheck(makeCheck(p.id, { created_at: new Date(monthStart).toISOString() }));
        await store.insertCheck(makeCheck(p.id, { created_at: now.toISOString() }));
        await store.insertCheck(makeCheck(p.id, { created_at: new Date(monthStart - 1).toISOString() }));
        await store.insertCheck(makeCheck(other.id, { created_at: now.toISOString() }));
        expect(await store.monthlyUsage(p.id)).toBe(2);
      });

      it("ranks signals by frequency within the window, scoped to the project", async () => {
        const p = await newProject();
        const other = await newProject();
        const now = new Date().toISOString();
        await store.insertCheck(makeCheck(p.id, { created_at: now, signals: [sig("disposable_domain", 80), sig("plus_alias")] }));
        await store.insertCheck(makeCheck(p.id, { created_at: now, signals: [sig("disposable_domain", 80)] }));
        await store.insertCheck(makeCheck(p.id, { created_at: at(-1), signals: [sig("ip_velocity", 45), sig("plus_alias")] }));
        await store.insertCheck(makeCheck(p.id, { created_at: now, signals: [] }));
        await store.insertCheck(makeCheck(p.id, { created_at: at(-20), signals: [sig("no_mx", 70)] })); // outside 7 days
        await store.insertCheck(makeCheck(other.id, { created_at: now, signals: [sig("bot_user_agent", 30)] }));
        const top = await store.topSignals(p.id, 7);
        expect(top[0]).toEqual({ id: "disposable_domain", count: 2 });
        expect(top[1]).toEqual({ id: "plus_alias", count: 2 });
        expect(top.slice(2)).toEqual([{ id: "ip_velocity", count: 1 }]);
        expect(await store.topSignals((await newProject()).id, 7)).toEqual([]);
      });
    });
  });
}
