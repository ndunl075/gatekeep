import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_PER_MIN, createCheckService } from "./check-service";
import { generateKey } from "./keys";
import { PLANS } from "./plans";
import { MemoryCounters, MemoryStore } from "./store/memory";
import type { Counters } from "./store/types";
import type { CheckLog } from "./types";

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";

async function setup(overrides: Parameters<typeof createCheckService>[0] = {}) {
  const store = new MemoryStore();
  const counters = new MemoryCounters();
  const project = await store.createProject("owner", "test");
  const { plaintext, key } = generateKey(project.id, "k");
  await store.insertKey(key);
  const pending: Promise<unknown>[] = [];
  const service = createCheckService({
    store: () => store,
    counters: () => counters,
    resolveMx: async () => true,
    defer: (fn) => void pending.push(fn()),
    ...overrides,
  });
  const flush = () => Promise.all(pending.splice(0));
  const check = async (body: unknown, apiKey: string | null = plaintext) => {
    const out = await service.runCheck(apiKey, body);
    await flush();
    return out;
  };
  return { store, counters, project, key, plaintext, service, check, flush };
}

const signup = (n: number, extra: object = {}) => ({
  email: `person${n}@northwind.io`,
  ip: "198.51.100.7",
  user_agent: BROWSER_UA,
  ...extra,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("auth", () => {
  it("401 for a missing key", async () => {
    const { check } = await setup();
    const out = await check(signup(1), null);
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ error: "unauthorized" });
  });

  it("401 for an unknown key", async () => {
    const { check } = await setup();
    expect((await check(signup(1), "gk_live_" + "x".repeat(40))).status).toBe(401);
  });

  it("401 for a revoked key", async () => {
    const { check, store, project, key } = await setup();
    await store.revokeKey(project.id, key.id);
    expect((await check(signup(1))).status).toBe(401);
  });
});

describe("auth hardening", () => {
  const wellFormed = (n: number) => `gk_live_${String(n).padStart(40, "0").replace(/0/g, "a").slice(0, 36)}${String(n).padStart(4, "0")}`;

  it("a keyless request is a 401 even when the store is broken", async () => {
    const { check } = await setup({
      store: () => {
        throw new Error("not configured");
      },
    });
    const out = await check(signup(1), null);
    expect(out.status).toBe(401);
  });

  it.each(["gk_live_nope", "sk_live_" + "a".repeat(40), "gk_live_" + "a".repeat(39), "gk_live_" + "a".repeat(41), "gk_live_" + "a".repeat(39) + "-"])(
    "malformed key %s is a 401 without touching the store",
    async (bad) => {
      const { check, store } = await setup();
      const find = vi.spyOn(store, "findKeyByHash");
      expect((await check(signup(1), bad)).status).toBe(401);
      expect(find).not.toHaveBeenCalled();
    },
  );

  it("the demo key shape is allowed through to the lookup", async () => {
    const { check, store } = await setup();
    const find = vi.spyOn(store, "findKeyByHash");
    expect((await check(signup(1), "gk_live_demo_key_for_the_playground_only")).status).toBe(401); // not in this store
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("remembers unknown keys for 60s", async () => {
    let t = Date.now();
    const { service, store } = await setup({ now: () => t });
    const find = vi.spyOn(store, "findKeyByHash");
    const unknown = wellFormed(1);
    expect((await service.runCheck(unknown, signup(1))).status).toBe(401);
    expect((await service.runCheck(unknown, signup(1))).status).toBe(401);
    expect(find).toHaveBeenCalledTimes(1);
    t += 61_000;
    await service.runCheck(unknown, signup(1));
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("the negative cache is bounded (oldest evicted)", async () => {
    const { service, store } = await setup();
    const find = vi.spyOn(store, "findKeyByHash");
    for (let i = 0; i < 1001; i++) await service.runCheck(wellFormed(i), signup(1));
    expect(find).toHaveBeenCalledTimes(1001);
    await service.runCheck(wellFormed(1000), signup(1)); // newest: cached
    expect(find).toHaveBeenCalledTimes(1001);
    await service.runCheck(wellFormed(0), signup(1)); // oldest: evicted
    expect(find).toHaveBeenCalledTimes(1002);
  });
});

describe("hung dependencies", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());
  const never = () => new Promise<never>(() => {});

  it("fails open when the key lookup never answers", async () => {
    const { service, store, plaintext } = await setup();
    vi.spyOn(store, "findKeyByHash").mockImplementation(never);
    const p = service.runCheck(plaintext, signup(1, { email: "Maya@Northwind.io" }));
    await vi.advanceTimersByTimeAsync(1000);
    const out = await p;
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ decision: "allow", error: "internal_error", normalized_email: "maya@northwind.io" });
  });

  it("fails open when the project lookup never answers", async () => {
    const { service, store, plaintext } = await setup();
    vi.spyOn(store, "getProject").mockImplementation(never);
    const p = service.runCheck(plaintext, signup(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).body).toMatchObject({ decision: "allow", error: "internal_error" });
  });

  it("does not remember a key as unknown just because the store hung", async () => {
    const { service, store, plaintext } = await setup();
    const find = vi.spyOn(store, "findKeyByHash").mockImplementationOnce(never);
    const p = service.runCheck(plaintext, signup(1));
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect((await service.runCheck(plaintext, signup(2))).status).toBe(200);
    expect((await service.runCheck(plaintext, signup(3))).body).not.toHaveProperty("error");
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("a hung usage count means 'not exceeded' after 300ms, not an error", async () => {
    const { service, store, plaintext, flush } = await setup();
    vi.spyOn(store, "monthlyUsage").mockImplementation(never);
    const p = service.runCheck(plaintext, signup(1, { email: "burner@mailinator.com" }));
    await vi.advanceTimersByTimeAsync(300);
    const out = await p;
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ decision: "block" });
    expect(out.body).not.toHaveProperty("error");
    expect(out.body).not.toHaveProperty("quota_exceeded");
    await flush();
  });

  it("the response does not wait for a hung insert, and the write is abandoned", async () => {
    const { service, store, plaintext, flush } = await setup();
    vi.spyOn(store, "insertCheck").mockImplementation(never);
    const out = await service.runCheck(plaintext, signup(1)); // resolves with no timers advanced
    expect(out.body).toMatchObject({ decision: "allow" });
    await vi.advanceTimersByTimeAsync(5000);
    await flush(); // the deferred work settles instead of hanging
    expect(console.error).toHaveBeenCalled();
  });

  it("the playground waits at most 2s for its insert", async () => {
    const { service, store, project } = await setup();
    vi.spyOn(store, "insertCheck").mockImplementation(never);
    const p = service.runCheckForProject(project, { email: "burner@mailinator.com" });
    await vi.advanceTimersByTimeAsync(2000);
    const out = await p;
    expect(out).toMatchObject({ decision: "block" });
    expect(out.error).toBeUndefined();
  });
});

describe("validation", () => {
  it.each([
    ["no email", {}, /email/],
    ["email not a string", { email: 42 }, /email/],
    ["empty email", { email: "" }, /email/],
    ["email too long", { email: "a".repeat(321) + "@x.io" }, /email/],
    ["ip too long", { email: "a@b.co", ip: "1".repeat(65) }, /ip/],
    ["user_agent too long", { email: "a@b.co", user_agent: "u".repeat(1025) }, /user_agent/],
    ["device_id too long", { email: "a@b.co", device_id: "d".repeat(129) }, /device_id/],
    ["name too long", { email: "a@b.co", name: "n".repeat(201) }, /name/],
    ["body is an array", [], /./],
    ["body is null", null, /./],
  ])("400: %s", async (_label, body, message) => {
    const { check } = await setup();
    const out = await check(body);
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: "invalid_request", message: expect.stringMatching(message) });
  });

  it("ignores unknown fields and accepts null optionals", async () => {
    const { check } = await setup();
    const out = await check({ email: "maya@northwind.io", ip: null, user_agent: BROWSER_UA, plan: "enterprise", extra: { a: 1 } });
    expect(out.status).toBe(200);
  });
});

describe("decisions", () => {
  it("allows a clean signup", async () => {
    const { check } = await setup();
    const out = await check(signup(1, { email: "maya.chen@northwind.io" }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ decision: "allow", score: 0, signals: [], normalized_email: "maya.chen@northwind.io" });
    expect(out.body).toHaveProperty("id");
    expect(out.body).not.toHaveProperty("error");
    expect(out.body).not.toHaveProperty("quota_exceeded");
  });

  it("blocks a mailinator address", async () => {
    const { check } = await setup();
    const out = await check(signup(1, { email: "burner@mailinator.com" }));
    expect(out.body).toMatchObject({ decision: "block" });
    expect((out.body as { signals: { id: string }[] }).signals.map((s) => s.id)).toContain("disposable_domain");
  });

  it("blocks a domain without MX", async () => {
    const { check } = await setup({ resolveMx: async () => false });
    expect((await check(signup(1))).body).toMatchObject({ decision: "block" });
  });

  it("an unknown MX answer (null) adds no signal", async () => {
    const { check } = await setup({ resolveMx: async () => null });
    expect((await check(signup(1))).body).toMatchObject({ decision: "allow", score: 0 });
  });

  it("challenges the 3rd signup from the same IP", async () => {
    const { check } = await setup();
    const decisions = [];
    for (let i = 1; i <= 3; i++) decisions.push(((await check(signup(i))).body as { decision: string }).decision);
    expect(decisions).toEqual(["allow", "allow", "challenge"]);
  });

  it("uses the project's thresholds", async () => {
    const { check, store, project } = await setup();
    await store.updateProject(project.id, { challenge_threshold: 5, block_threshold: 15 });
    // +tag alias and dots on gmail: 20 points.
    expect((await check(signup(1, { email: "n.ico+7@gmail.com" }))).body).toMatchObject({ decision: "block" });
  });
});

describe("quota", () => {
  const seed = async (store: MemoryStore, projectId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await store.insertCheck({ ...logFixture(projectId), id: crypto.randomUUID() });
    }
  };

  it("flags quota_exceeded but still runs the check", async () => {
    const { check, store, project } = await setup();
    await seed(store, project.id, PLANS.free.checksPerMonth);
    const out = await check(signup(1, { email: "burner@mailinator.com" }));
    expect(out.body).toMatchObject({ decision: "block", quota_exceeded: true });
  });

  it("does not flag below the quota", async () => {
    const { check, store, project } = await setup();
    await seed(store, project.id, PLANS.free.checksPerMonth - 2);
    expect((await check(signup(1))).body).not.toHaveProperty("quota_exceeded");
    expect((await check(signup(2, { ip: "198.51.100.8" }))).body).not.toHaveProperty("quota_exceeded");
    // The cached usage includes the checks just made, so the 501st is flagged without a fresh count.
    expect((await check(signup(3, { ip: "198.51.100.9" }))).body).toHaveProperty("quota_exceeded", true);
  });

  it("a higher plan has more room", async () => {
    const { check, store, project } = await setup();
    await store.setBilling(project.id, { plan: "pro" });
    await seed(store, project.id, PLANS.free.checksPerMonth);
    expect((await check(signup(1))).body).not.toHaveProperty("quota_exceeded");
  });
});

describe("rate limit", () => {
  it("429 with Retry-After past 600 requests a minute", async () => {
    const { check, counters, key } = await setup();
    for (let i = 0; i < RATE_LIMIT_PER_MIN - 1; i++) await counters.hit(`gk:rl:${key.id}`, 60);
    expect((await check(signup(1))).status).toBe(200); // the 600th
    const out = await check(signup(2));
    expect(out.status).toBe(429);
    expect(out.body).toMatchObject({ error: "rate_limited" });
    expect(out).toHaveProperty("retryAfterSec");
  });

  it("is per key", async () => {
    const { check, counters, key, store, project } = await setup();
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) await counters.hit(`gk:rl:${key.id}`, 60);
    const other = generateKey(project.id, "other");
    await store.insertKey(other.key);
    expect((await check(signup(1))).status).toBe(429);
    expect((await check(signup(1), other.plaintext)).status).toBe(200);
  });

  it("without a shared rate limit (Postgres) it limits per instance and never asks the counters", async () => {
    const hit = vi.fn<Counters["hit"]>(async () => 1);
    const counters: Counters = { hit, count: async () => 0 };
    const { service, plaintext } = await setup({ counters: () => counters, sharedRateLimit: () => false });
    let last = 200;
    for (let i = 0; i < RATE_LIMIT_PER_MIN + 1; i++) last = (await service.runCheck(plaintext, signup(i))).status;
    expect(last).toBe(429);
    expect(hit.mock.calls.filter(([k]) => String(k).startsWith("gk:rl:"))).toHaveLength(0);
  });

  it("falls back to an in-process limiter when the counters reject", async () => {
    const broken: Counters = {
      hit: async () => {
        throw new Error("redis down");
      },
      count: async () => {
        throw new Error("redis down");
      },
    };
    const { check } = await setup({ counters: () => broken });
    const out = await check(signup(1));
    expect(out.status).toBe(200);
    // Engine counters are down too: degraded, no velocity signals, still a real answer.
    expect(out.body).toMatchObject({ decision: "allow" });
    expect(out.body).not.toHaveProperty("error");
  });
});

describe("fail open", () => {
  it("allows with an error when the engine throws", async () => {
    const { check, store } = await setup({
      runChecks: async () => {
        throw new Error("engine exploded");
      },
    });
    const out = await check(signup(1));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ decision: "allow", score: 0, error: "internal_error", signals: [] });
    expect(console.error).toHaveBeenCalled();
    expect(store.checks).toHaveLength(0);
  });

  it("allows with an error when the store is down", async () => {
    const { check, store } = await setup();
    vi.spyOn(store, "findKeyByHash").mockRejectedValue(new Error("db down"));
    const out = await check(signup(1, { email: "Maya@Northwind.io" }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ decision: "allow", error: "internal_error", normalized_email: "maya@northwind.io" });
  });

  it("a failing insert does not change the answer", async () => {
    const { check, store } = await setup();
    vi.spyOn(store, "insertCheck").mockRejectedValue(new Error("write failed"));
    const out = await check(signup(1, { email: "burner@mailinator.com" }));
    expect(out.body).toMatchObject({ decision: "block" });
    expect(out.body).not.toHaveProperty("error");
  });

  it("logs a degraded marker once, not on every check", async () => {
    const { check } = await setup({
      runChecks: async () => ({
        decision: "allow",
        score: 0,
        reason: "No risk signals",
        signals: [],
        normalized_email: "a@b.co",
        email_domain: "b.co",
        degraded: ["counters_error"],
      }),
    });
    await check(signup(1));
    await check(signup(2));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("counters_error");
  });
});

describe("persistence", () => {
  it("stores a CheckLog matching the response", async () => {
    const { check, store, project, key } = await setup();
    const out = await check({
      email: "Burner@Mailinator.com",
      ip: " 198.51.100.7 ",
      user_agent: BROWSER_UA,
      device_id: "Dev-123",
      name: "Burner",
    });
    expect(store.checks).toHaveLength(1);
    const log = store.checks[0] as CheckLog;
    const body = out.body as { id: string; decision: string; score: number; reason: string; signals: unknown[]; latency_ms: number };
    expect(log).toMatchObject({
      id: body.id,
      project_id: project.id,
      email: "Burner@Mailinator.com",
      normalized_email: "burner@mailinator.com",
      email_domain: "mailinator.com",
      ip: "198.51.100.7",
      user_agent: BROWSER_UA,
      device_id: "dev-123",
      decision: "block",
      score: body.score,
      reason: body.reason,
      signals: body.signals,
      latency_ms: body.latency_ms,
    });
    expect(Number.isInteger(log.latency_ms)).toBe(true);
    expect(Date.parse(log.created_at)).not.toBeNaN();
    expect((await store.listKeys(project.id)).find((k) => k.id === key.id)?.last_used_at).not.toBeNull();
  });

  it("missing optional fields are stored as null", async () => {
    const { check, store } = await setup();
    await check({ email: "maya@northwind.io" });
    expect(store.checks[0]).toMatchObject({ ip: null, user_agent: null, device_id: null });
  });

  it("does not write last_used_at more than once a minute", async () => {
    let t = Date.now();
    const { service, store, project, plaintext, flush } = await setup({ now: () => t });
    const touch = vi.spyOn(store, "touchKey");
    await service.runCheck(plaintext, signup(1));
    await flush();
    expect(touch).toHaveBeenCalledTimes(1);
    // The key row in the store now says "used just now", but the service reads it fresh each call.
    t += 30_000;
    await service.runCheck(plaintext, signup(2, { ip: "198.51.100.9" }));
    await flush();
    expect(touch).toHaveBeenCalledTimes(1);
    t += 61_000;
    await service.runCheck(plaintext, signup(3, { ip: "198.51.100.10" }));
    await flush();
    expect(touch).toHaveBeenCalledTimes(2);
    expect(project.id).toBeTruthy();
  });
});

describe("runCheckForProject (playground)", () => {
  it("records unless dry run", async () => {
    const { service, store, project } = await setup();
    const real = await service.runCheckForProject(project, { email: "burner@mailinator.com" });
    expect(real.decision).toBe("block");
    expect(store.checks).toHaveLength(1);
    await service.runCheckForProject(project, { email: "burner@mailinator.com" }, { dryRun: true });
    expect(store.checks).toHaveLength(1);
  });

  it("a dry run scores like the real call and leaves counters alone", async () => {
    const { service, project } = await setup();
    const input = { email: "maya@northwind.io", ip: "203.0.113.50", user_agent: BROWSER_UA };
    for (let i = 0; i < 5; i++) {
      const dry = await service.runCheckForProject(project, input, { dryRun: true });
      expect(dry.score).toBe(0);
    }
    await service.runCheckForProject(project, input);
    const second = await service.runCheckForProject(project, input, { dryRun: true });
    expect(second.signals.map((s) => s.id)).not.toContain("ip_velocity");
  });

  it("rejects invalid input", async () => {
    const { service, project } = await setup();
    await expect(service.runCheckForProject(project, { email: "" })).rejects.toThrow();
  });
});

function logFixture(projectId: string): CheckLog {
  return {
    id: "",
    project_id: projectId,
    created_at: new Date().toISOString(),
    email: "x@y.co",
    normalized_email: "x@y.co",
    email_domain: "y.co",
    ip: null,
    user_agent: null,
    device_id: null,
    decision: "allow",
    score: 0,
    reason: "",
    signals: [],
    latency_ms: 1,
  };
}
