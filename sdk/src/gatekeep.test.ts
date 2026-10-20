import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatekeep, getClientIp } from "./index";
import { handleClerkUserCreated } from "./clerk";
import { createSupabaseBeforeUserCreatedHandler, verifyStandardWebhook } from "./supabase";
import { withGatekeep } from "./nextauth";
import { createPrecheckHandler } from "./precheck";
import type { CheckResult, Decision, Gatekeep } from "./types";

const result = (decision: Decision, extra: Partial<CheckResult> = {}): CheckResult => ({
  id: "chk_1",
  decision,
  score: decision === "allow" ? 0 : 80,
  reason: "test",
  signals: [],
  normalized_email: "a@b.com",
  latency_ms: 5,
  ...extra,
});
const stub = (decision: Decision): Gatekeep => ({ check: vi.fn(async () => result(decision)) });
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("createGatekeep", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts with bearer auth to baseUrl and returns the result", async () => {
    const f = vi.fn(async () => jsonRes(200, result("block")));
    const gk = createGatekeep({ apiKey: "gk_live_x", baseUrl: "https://example.com/", fetch: f as unknown as typeof fetch });
    const r = await gk.check({ email: "a@b.com", ip: "1.2.3.4" });
    expect(r.decision).toBe("block");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/api/v1/check");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gk_live_x");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", ip: "1.2.3.4" });
  });

  it("fails open on network error", async () => {
    const gk = createGatekeep({ apiKey: "k", fetch: (async () => { throw new Error("boom"); }) as typeof fetch });
    const r = await gk.check({ email: "A@B.com" });
    expect(r).toMatchObject({ decision: "allow", score: 0, reason: "gatekeep unavailable", signals: [], error: "boom" });
  });

  it("fails open on 5xx and invalid JSON", async () => {
    const g5 = createGatekeep({ apiKey: "k", fetch: (async () => jsonRes(503, {})) as typeof fetch });
    expect((await g5.check({ email: "a@b.com" })).error).toBe("http_503");
    const gj = createGatekeep({ apiKey: "k", fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    const r = await gj.check({ email: "a@b.com" });
    expect(r.decision).toBe("allow");
    expect(r.error).toBe("invalid_json");
    const gs = createGatekeep({ apiKey: "k", fetch: (async () => jsonRes(200, { nope: 1 })) as typeof fetch });
    expect((await gs.check({ email: "a@b.com" })).error).toBe("invalid_response");
  });

  it("fails open on 401 and 400 and warns only once", async () => {
    const warn = vi.mocked(console.warn);
    const gk = createGatekeep({ apiKey: "bad", fetch: (async () => jsonRes(401, {})) as typeof fetch });
    expect((await gk.check({ email: "a@b.com" })).error).toBe("http_401");
    expect((await gk.check({ email: "a@b.com" })).decision).toBe("allow");
    expect(warn).toHaveBeenCalledTimes(1);
    const g4 = createGatekeep({ apiKey: "k", fetch: (async () => jsonRes(400, {})) as typeof fetch });
    const r = await g4.check({ email: "" });
    expect(r).toMatchObject({ decision: "allow", error: "http_400" });
  });

  it("fails open on timeout and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = vi.fn((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const gk = createGatekeep({ apiKey: "k", timeoutMs: 1000, fetch: f as unknown as typeof fetch });
    const p = gk.check({ email: "a@b.com" });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.decision).toBe("allow");
    expect(r.error).toMatch(/timeout/);
    expect(signal?.aborted).toBe(true);
  });
});

describe("getClientIp", () => {
  it("prefers the first x-forwarded-for hop, then x-real-ip, then cf-connecting-ip", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "3.3.3.3" }))).toBe("1.1.1.1");
    expect(getClientIp(new Headers({ "x-real-ip": "3.3.3.3", "cf-connecting-ip": "4.4.4.4" }))).toBe("3.3.3.3");
    expect(getClientIp(new Headers({ "cf-connecting-ip": "4.4.4.4" }))).toBe("4.4.4.4");
    expect(getClientIp({ "X-Forwarded-For": ["5.5.5.5"] })).toBe("5.5.5.5");
    expect(getClientIp(new Headers())).toBeUndefined();
  });
});

describe("handleClerkUserCreated", () => {
  const clerk = () => ({
    users: { banUser: vi.fn(async () => {}), deleteUser: vi.fn(async () => {}), updateUserMetadata: vi.fn(async () => {}) },
  });
  const event = {
    type: "user.created",
    data: {
      id: "user_1",
      first_name: "Ann",
      last_name: "Lee",
      primary_email_address_id: "e2",
      email_addresses: [{ id: "e1", email_address: "x@y.com" }, { id: "e2", email_address: "ann@z.com" }],
    },
  };

  it("bans on block, using the primary email", async () => {
    const c = clerk();
    const gatekeep = stub("block");
    const r = await handleClerkUserCreated({ gatekeep, clerk: c, event });
    expect(r.action).toBe("banned");
    expect(c.users.banUser).toHaveBeenCalledWith("user_1");
    expect(gatekeep.check).toHaveBeenCalledWith(expect.objectContaining({ email: "ann@z.com", name: "Ann Lee" }));
  });
  it("sends no ip from the webhook request", async () => {
    const gatekeep = stub("allow");
    await handleClerkUserCreated({ gatekeep, clerk: clerk(), event, userAgent: "ua" });
    const arg = vi.mocked(gatekeep.check).mock.calls[0][0];
    expect(arg).not.toHaveProperty("ip", expect.anything());
    expect(arg.user_agent).toBe("ua");
  });
  it("deletes on block when asked", async () => {
    const c = clerk();
    const r = await handleClerkUserCreated({ gatekeep: stub("block"), clerk: c, event, deleteOnBlock: true });
    expect(r.action).toBe("deleted");
    expect(c.users.deleteUser).toHaveBeenCalledWith("user_1");
    expect(c.users.banUser).not.toHaveBeenCalled();
  });
  it("flags metadata on challenge", async () => {
    const c = clerk();
    const r = await handleClerkUserCreated({ gatekeep: stub("challenge"), clerk: c, event });
    expect(r.action).toBe("flagged");
    expect(c.users.updateUserMetadata).toHaveBeenCalledWith("user_1", { publicMetadata: { gatekeep: "challenge" } });
  });
  it("does nothing on allow or without an email, and survives clerk errors", async () => {
    const c = clerk();
    expect((await handleClerkUserCreated({ gatekeep: stub("allow"), clerk: c, event })).action).toBe("none");
    expect((await handleClerkUserCreated({ gatekeep: stub("block"), clerk: c, event: { data: { id: "u" } } })).action).toBe("none");
    c.users.banUser.mockRejectedValue(new Error("clerk down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await handleClerkUserCreated({ gatekeep: stub("block"), clerk: c, event })).action).toBe("none");
  });
});

describe("Standard Webhooks verification", () => {
  // Vector from the Standard Webhooks spec / Svix docs.
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const body = '{"test": 2432232314}';
  const hdrs = (sig: string, ts = "1614265330") =>
    new Headers({ "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek", "webhook-timestamp": ts, "webhook-signature": sig });
  const now = 1614265330 * 1000;

  it("accepts the known vector (with and without the v1, prefix)", async () => {
    const h = hdrs("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
    expect(await verifyStandardWebhook(secret, body, h, { now })).toBe(true);
    expect(await verifyStandardWebhook("v1," + secret, body, h, { now })).toBe(true);
  });
  it("accepts any matching signature in a rotated list", async () => {
    const h = hdrs("v1,AAAA v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
    expect(await verifyStandardWebhook(secret, body, h, { now })).toBe(true);
  });
  it("rejects a tampered body, wrong signature, missing headers and stale timestamps", async () => {
    const good = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
    expect(await verifyStandardWebhook(secret, body + " ", hdrs(good), { now })).toBe(false);
    expect(await verifyStandardWebhook(secret, body, hdrs("v1,AAAA"), { now })).toBe(false);
    expect(await verifyStandardWebhook(secret, body, new Headers(), { now })).toBe(false);
    expect(await verifyStandardWebhook(secret, body, hdrs(good), { now: now + 3600_000 })).toBe(false);
  });
});

describe("Supabase before-user-created handler", () => {
  const secretB64 = btoa("0123456789abcdef0123456789abcdef");
  const hookSecret = `v1,whsec_${secretB64}`;
  const now = 1_700_000_000_000;

  async function signed(payload: unknown, opts: { secret?: string; ts?: number } = {}) {
    const body = JSON.stringify(payload);
    const id = "msg_1";
    const ts = String(opts.ts ?? now / 1000);
    const bin = atob(opts.secret ?? secretB64);
    const raw = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
    return new Request("https://app.test/hook", {
      method: "POST",
      body,
      headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1," + btoa(String.fromCharCode(...sig)), "user-agent": "supabase-auth" },
    });
  }
  const payload = { metadata: { ip_address: "9.9.9.9" }, user: { email: "t@mailinator.com", user_metadata: { full_name: "T" } } };

  it("rejects blocked signups with 400 and the hook error shape", async () => {
    const gatekeep = stub("block");
    const h = createSupabaseBeforeUserCreatedHandler({ gatekeep, hookSecret, now: () => now });
    const res = await h(await signed(payload));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.http_code).toBe(400);
    expect(typeof j.error.message).toBe("string");
    expect(gatekeep.check).toHaveBeenCalledWith(expect.objectContaining({ email: "t@mailinator.com", ip: "9.9.9.9", name: "T", user_agent: "supabase-auth" }));
  });
  it("ignores hook request headers for the ip and uses only the payload", async () => {
    const gatekeep = stub("allow");
    const h = createSupabaseBeforeUserCreatedHandler({ gatekeep, hookSecret, now: () => now });
    const req = await signed({ user: { email: "a@b.com" } });
    req.headers.set("x-forwarded-for", "10.0.0.1");
    await h(req);
    expect(vi.mocked(gatekeep.check).mock.calls[0][0].ip).toBeUndefined();
  });
  it("allows with {} and calls onChallenge", async () => {
    const onChallenge = vi.fn();
    const h = createSupabaseBeforeUserCreatedHandler({ gatekeep: stub("challenge"), hookSecret, onChallenge, now: () => now });
    const res = await h(await signed(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(onChallenge).toHaveBeenCalledWith(expect.objectContaining({ email: "t@mailinator.com" }));
    const a = createSupabaseBeforeUserCreatedHandler({ gatekeep: stub("allow"), hookSecret, now: () => now });
    expect((await a(await signed(payload))).status).toBe(200);
  });
  it("returns 401 for a bad signature or stale timestamp", async () => {
    const h = createSupabaseBeforeUserCreatedHandler({ gatekeep: stub("block"), hookSecret, now: () => now });
    expect((await h(await signed(payload, { secret: btoa("another-secret-another-secret-12") }))).status).toBe(401);
    expect((await h(await signed(payload, { ts: now / 1000 - 3600 }))).status).toBe(401);
  });
  it("fails open when gatekeep throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gatekeep: Gatekeep = { check: vi.fn(async () => { throw new Error("x"); }) };
    const h = createSupabaseBeforeUserCreatedHandler({ gatekeep, hookSecret, now: () => now });
    expect((await h(await signed(payload))).status).toBe(200);
  });
});

describe("withGatekeep (NextAuth)", () => {
  const params = { user: { email: "a@b.com", name: "A" }, account: { provider: "google" } };

  it("returns false on block, or the redirect", async () => {
    expect(await withGatekeep({ gatekeep: stub("block") })(params)).toBe(false);
    expect(await withGatekeep({ gatekeep: stub("block"), blockRedirect: "/blocked" })(params)).toBe("/blocked");
  });
  it("redirects on challenge only when configured", async () => {
    expect(await withGatekeep({ gatekeep: stub("challenge"), challengeRedirect: "/verify" })(params)).toBe("/verify");
    expect(await withGatekeep({ gatekeep: stub("challenge") })(params)).toBe(true);
  });
  it("allows and runs the inner callback", async () => {
    const inner = vi.fn(async () => "/welcome");
    expect(await withGatekeep({ gatekeep: stub("allow") }, inner)(params)).toBe("/welcome");
  });
  it("skips existing users, credentials and email-link clicks", async () => {
    const g = stub("block");
    expect(await withGatekeep({ gatekeep: g, isExistingUser: () => true })(params)).toBe(true);
    expect(await withGatekeep({ gatekeep: g })({ user: { email: "a@b.com" }, account: { provider: "credentials" } })).toBe(true);
    expect(await withGatekeep({ gatekeep: g })({ user: { email: "a@b.com" }, account: { provider: "email" }, email: {} })).toBe(true);
    expect(g.check).not.toHaveBeenCalled();
    expect(await withGatekeep({ gatekeep: g })({ user: { email: "a@b.com" }, account: { provider: "email" }, email: { verificationRequest: true } })).toBe(false);
  });
  it("checks the link request but not the click, for v4 (email) and v5 (nodemailer, resend) shapes", async () => {
    for (const [provider, type] of [["email", "email"], ["nodemailer", "email"], ["resend", "email"]]) {
      const g = stub("block");
      const wrapped = withGatekeep({ gatekeep: g });
      // click-through of an existing user: no `email` param
      expect(await wrapped({ user: { email: "a@b.com" }, account: { provider, type } })).toBe(true);
      expect(await wrapped({ user: { email: "a@b.com" }, account: { provider, type }, email: { verificationRequest: false } })).toBe(true);
      expect(g.check).not.toHaveBeenCalled();
      // link request
      expect(await wrapped({ user: { email: "a@b.com" }, account: { provider, type }, email: { verificationRequest: true } })).toBe(false);
      expect(g.check).toHaveBeenCalledTimes(1);
    }
  });
  it("passes request info and fails open if the check throws", async () => {
    const g = stub("allow");
    await withGatekeep({ gatekeep: g, getRequestInfo: () => ({ ip: "1.1.1.1", userAgent: "ua" }) })(params);
    expect(g.check).toHaveBeenCalledWith(expect.objectContaining({ ip: "1.1.1.1", user_agent: "ua", name: "A" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad: Gatekeep = { check: async () => { throw new Error("x"); } };
    expect(await withGatekeep({ gatekeep: bad })(params)).toBe(true);
  });
});

describe("createPrecheckHandler", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://app.test/api/gatekeep/precheck", { method: "POST", body: JSON.stringify(body), headers });

  it("uses the real client ip, ua and device id and returns only the decision", async () => {
    const gatekeep: Gatekeep = { check: vi.fn(async () => result("block", { score: 90, reason: "secret" })) };
    const res = await createPrecheckHandler({ gatekeep })(
      post({ email: "a@b.com", device_id: "d1", name: "A" }, { "x-forwarded-for": "7.7.7.7, 10.0.0.1", "user-agent": "Mozilla" }),
    );
    expect(await res.json()).toEqual({ decision: "block" });
    expect(gatekeep.check).toHaveBeenCalledWith({ email: "a@b.com", ip: "7.7.7.7", user_agent: "Mozilla", device_id: "d1", name: "A" });
  });
  it("fails open on bad bodies and gatekeep errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gatekeep: Gatekeep = { check: vi.fn(async () => { throw new Error("x"); }) };
    const h = createPrecheckHandler({ gatekeep });
    expect(await (await h(post({ email: "a@b.com" }))).json()).toEqual({ decision: "allow" });
    expect(await (await h(new Request("https://app.test/x", { method: "POST", body: "nope" }))).json()).toEqual({ decision: "allow" });
    expect(await (await h(post({}))).json()).toEqual({ decision: "allow" });
  });
});
