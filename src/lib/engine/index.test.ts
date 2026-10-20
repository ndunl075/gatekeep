import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCounters } from "../store/memory";
import type { Counters } from "../store/types";
import type { CheckInput, SignalId } from "../types";
import { runChecks, type EngineContext } from "./index";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const THRESHOLDS = { challenge: 40, block: 70 };

let now: number;
let counters: MemoryCounters;
let resolveMx: ReturnType<typeof vi.fn<(d: string) => Promise<boolean | null>>>;

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return { projectId: "p1", counters, resolveMx, thresholds: THRESHOLDS, ...over };
}
function input(over: Partial<CheckInput> = {}): CheckInput {
  return { email: "maria.garcia@example.com", ip: "1.2.3.4", user_agent: CHROME, ...over };
}
const ids = (r: { signals: { id: SignalId }[] }) => r.signals.map((s) => s.id);

beforeEach(() => {
  now = Date.parse("2026-01-15T12:00:00Z");
  counters = new MemoryCounters(() => now);
  resolveMx = vi.fn(async () => true);
});

describe("clean signup", () => {
  it("allows with no signals", async () => {
    const r = await runChecks(input(), ctx());
    expect(r).toMatchObject({
      decision: "allow",
      score: 0,
      reason: "No risk signals",
      signals: [],
      normalized_email: "maria.garcia@example.com",
      email_domain: "example.com",
    });
  });
});

describe("invalid_email", () => {
  it("short-circuits with score 100 / block and touches nothing", async () => {
    const hit = vi.spyOn(counters, "hit");
    const r = await runChecks(input({ email: "not-an-email" }), ctx());
    expect(r.decision).toBe("block");
    expect(r.score).toBe(100);
    expect(ids(r)).toEqual(["invalid_email"]);
    expect(r.reason).toBe("Email address is not valid");
    expect(hit).not.toHaveBeenCalled();
    expect(resolveMx).not.toHaveBeenCalled();
  });
  it("keeps the typed value and domain for logging", async () => {
    const r = await runChecks(input({ email: " Foo@Bad_Domain " }), ctx());
    expect(r.normalized_email).toBe("foo@bad_domain");
    expect(r.email_domain).toBe("bad_domain");
  });
  it("blocks even if thresholds are above 100", async () => {
    const r = await runChecks(input({ email: "" }), ctx({ thresholds: { challenge: 120, block: 150 } }));
    expect(r.decision).toBe("block");
  });
});

describe("disposable_domain", () => {
  it("flags a listed domain (80 → block)", async () => {
    const r = await runChecks(input({ email: "x@mailinator.com" }), ctx());
    expect(ids(r)).toContain("disposable_domain");
    expect(r.signals.find((s) => s.id === "disposable_domain")?.points).toBe(80);
    expect(r.decision).toBe("block");
    expect(r.reason).toContain("mailinator.com");
  });
  it("matches parent domains", async () => {
    const r = await runChecks(input({ email: "maria.garcia@a.b.mailinator.com" }), ctx());
    expect(ids(r)).toContain("disposable_domain");
    expect(r.signals[0].detail).toContain("(mailinator.com)");
  });
  it("does not flag gmail", async () => {
    const r = await runChecks(input({ email: "maria.garcia@gmail.com" }), ctx());
    expect(ids(r)).not.toContain("disposable_domain");
  });
});

describe("no_mx", () => {
  it("flags a domain without MX (70 → block)", async () => {
    resolveMx.mockResolvedValue(false);
    const r = await runChecks(input(), ctx());
    expect(ids(r)).toEqual(["no_mx"]);
    expect(r.score).toBe(70);
    expect(r.decision).toBe("block");
    expect(resolveMx).toHaveBeenCalledWith("example.com");
  });
  it("gives no signal when unknown (null)", async () => {
    resolveMx.mockResolvedValue(null);
    expect(ids(await runChecks(input(), ctx()))).toEqual([]);
  });
  it("gives no signal when the resolver throws", async () => {
    resolveMx.mockRejectedValue(new Error("dns exploded"));
    expect(ids(await runChecks(input(), ctx()))).toEqual([]);
  });
  it("resolves the normalized domain (googlemail → gmail)", async () => {
    await runChecks(input({ email: "maria@googlemail.com" }), ctx());
    expect(resolveMx).toHaveBeenCalledWith("gmail.com");
  });
});

describe("ip_velocity", () => {
  it("is quiet for the 1st and 2nd check, 45 at 3rd, 60 at 6th", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await runChecks(input({ email: `user${i}name@example.com` }), ctx()));
    expect(ids(results[0])).not.toContain("ip_velocity");
    expect(ids(results[1])).not.toContain("ip_velocity");
    expect(results[2].signals.find((s) => s.id === "ip_velocity")?.points).toBe(45);
    expect(results[4].signals.find((s) => s.id === "ip_velocity")?.points).toBe(45);
    const sixth = results[5].signals.find((s) => s.id === "ip_velocity");
    expect(sixth?.points).toBe(60);
    expect(sixth?.detail).toBe("6 checks from this IP in 24h");
  });
  it("forgets after 24h", async () => {
    for (let i = 0; i < 3; i++) await runChecks(input({ email: `u${i}ser@example.com` }), ctx());
    now += 86_400_000 + 1000;
    expect(ids(await runChecks(input(), ctx()))).not.toContain("ip_velocity");
  });
  it("is skipped without an ip, and ips are separate", async () => {
    for (let i = 0; i < 5; i++) await runChecks(input({ ip: undefined }), ctx());
    expect(ids(await runChecks(input({ ip: undefined }), ctx()))).not.toContain("ip_velocity");
    for (let i = 0; i < 5; i++) await runChecks(input({ ip: "9.9.9.9" }), ctx());
    expect(ids(await runChecks(input({ ip: "5.5.5.5" }), ctx()))).not.toContain("ip_velocity");
  });
  it("uses the documented key scheme", async () => {
    const hit = vi.spyOn(counters, "hit");
    await runChecks(input({ device_id: "dev-1" }), ctx());
    const keys = hit.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "gk:p1:ip:1.2.3.4",
        "gk:p1:dev:dev-1",
        "gk:p1:em:maria.garcia@example.com",
        "gk:p1:burst",
      ]),
    );
  });
});

describe("device_velocity", () => {
  it("fires at 3 (45) and 6 (60) checks for one device", async () => {
    let r;
    for (let i = 1; i <= 6; i++) {
      r = await runChecks(input({ ip: `10.0.0.${i}`, email: `person${i}x@example.com`, device_id: "dev-1" }), ctx());
      const s = r.signals.find((x) => x.id === "device_velocity");
      if (i < 3) expect(s).toBeUndefined();
      if (i === 3) expect(s?.points).toBe(45);
      if (i === 6) expect(s?.points).toBe(60);
    }
  });
  it("is skipped without a device id", async () => {
    for (let i = 0; i < 4; i++) await runChecks(input({ email: `p${i}erson@example.com` }), ctx());
    expect(ids(await runChecks(input({ ip: undefined }), ctx()))).not.toContain("device_velocity");
  });
});

describe("email_reuse", () => {
  it("fires on the second check of the same normalized email", async () => {
    const first = await runChecks(input({ email: "maria.garcia+a@outlook.com" }), ctx());
    expect(ids(first)).not.toContain("email_reuse");
    const second = await runChecks(input({ email: "Maria.Garcia+b@outlook.com", ip: "8.8.8.8" }), ctx());
    expect(second.signals.find((s) => s.id === "email_reuse")?.points).toBe(35);
  });
  it("expires after 30 days", async () => {
    await runChecks(input(), ctx());
    now += 31 * 86_400_000;
    expect(ids(await runChecks(input(), ctx()))).not.toContain("email_reuse");
  });
});

describe("bot_user_agent", () => {
  it("flags empty and automated agents (30)", async () => {
    for (const ua of ["", "curl/8.4.0", "python-requests/2.31", "HeadlessChrome/126"]) {
      const r = await runChecks(input({ user_agent: ua, ip: undefined, email: `maria${ua?.length ?? 0}x@example.com` }), ctx());
      expect(r.signals.find((s) => s.id === "bot_user_agent")?.points, String(ua)).toBe(30);
    }
  });
  it("says why", async () => {
    expect((await runChecks(input({ user_agent: "" }), ctx())).reason).toBe("User agent is missing");
    expect((await runChecks(input({ user_agent: "curl/8", ip: "7.7.7.7", email: "other.person@example.com" }), ctx())).reason).toBe(
      "User agent looks automated (curl)",
    );
  });
});

describe("signup_burst", () => {
  async function seed(recent: number, older: number) {
    const key = "gk:p1:burst";
    for (let i = 0; i < older; i++) {
      now = Date.parse("2026-01-15T12:00:00Z") - 3_600_000 - i * 1000; // ~1h ago, outside the 10 min window
      await counters.hit(key, 600);
    }
    for (let i = 0; i < recent; i++) {
      now = Date.parse("2026-01-15T12:00:00Z") - 60_000 - i * 1000; // inside the last 10 min
      await counters.hit(key, 600);
    }
    now = Date.parse("2026-01-15T12:00:00Z");
  }
  it("fires at ≥20 in 10 min and ≥5x the trailing average", async () => {
    await seed(19, 0); // this check makes 20
    const r = await runChecks(input(), ctx());
    expect(r.signals.find((s) => s.id === "signup_burst")?.points).toBe(25);
  });
  it("needs at least 20 in 10 min", async () => {
    await seed(18, 0); // this check makes 19
    expect(ids(await runChecks(input(), ctx()))).not.toContain("signup_burst");
  });
  it("does not fire when the 10 min rate is not 5x the 24h average", async () => {
    // 20 now + 1000 earlier today: average per 10 min = 1020/144 ≈ 7.1, 5x = 35 > 20
    await seed(19, 1000);
    expect(ids(await runChecks(input(), ctx()))).not.toContain("signup_burst");
  });
  it("fires again once volume is far above the average", async () => {
    await seed(199, 100);
    expect(ids(await runChecks(input(), ctx()))).toContain("signup_burst");
  });
});

describe("gibberish_email / gibberish_name", () => {
  it("flags mashed local parts (25)", async () => {
    const r = await runChecks(input({ email: "asdfghjk@example.com" }), ctx());
    expect(r.signals.find((s) => s.id === "gibberish_email")?.points).toBe(25);
  });
  it("flags digit soup", async () => {
    expect(ids(await runChecks(input({ email: "x7k2m9p4q1@example.com" }), ctx()))).toContain("gibberish_email");
  });
  it("does not flag real addresses", async () => {
    for (const e of ["j.smith@example.com", "mchen92@example.com", "nguyen.van.an@example.com"]) {
      expect(ids(await runChecks(input({ email: e, ip: undefined }), ctx())), e).not.toContain("gibberish_email");
    }
  });
  it("flags a mashed name (20) but not real names", async () => {
    expect((await runChecks(input({ name: "asdfgh jkl" }), ctx())).signals.find((s) => s.id === "gibberish_name")?.points).toBe(20);
    for (const n of ["Nguyen Van An", "Siobhan O'Brien", "Oyelaran-Oyeyinka"]) {
      expect(ids(await runChecks(input({ name: n, ip: undefined }), ctx())), n).not.toContain("gibberish_name");
    }
  });
  it("judges the local part without the +tag", async () => {
    expect(ids(await runChecks(input({ email: "maria+xkqzvbtwq@gmail.com" }), ctx()))).not.toContain("gibberish_email");
  });
});

describe("plus_alias / dot_alias", () => {
  it("flags +tag on supporting providers (10)", async () => {
    const r = await runChecks(input({ email: "maria+promo@outlook.com" }), ctx());
    expect(r.signals.find((s) => s.id === "plus_alias")?.points).toBe(10);
    expect(r.normalized_email).toBe("maria@outlook.com");
  });
  it("ignores +tag where it is not an alias", async () => {
    expect(ids(await runChecks(input({ email: "maria+promo@example.com" }), ctx()))).not.toContain("plus_alias");
  });
  it("flags gmail dots (5) and both together (15)", async () => {
    const r = await runChecks(input({ email: "m.a.r.i.a+x@gmail.com" }), ctx());
    expect(ids(r).sort()).toEqual(["dot_alias", "plus_alias"]);
    expect(r.score).toBe(15);
    expect(r.decision).toBe("allow");
  });
});

describe("scoring", () => {
  it("adds points, caps at 100, sorts by points desc", async () => {
    resolveMx.mockResolvedValue(false);
    const r = await runChecks(input({ email: "a.sdfghjk+x@mailinator.com", user_agent: "curl/8" }), ctx());
    expect(r.score).toBe(100);
    const pts = r.signals.map((s) => s.points);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(pts.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
  });

  it("reason is the top two details joined by '; '", async () => {
    resolveMx.mockResolvedValue(false);
    const r = await runChecks(input({ email: "maria@mailinator.com", user_agent: "curl/8" }), ctx());
    expect(r.reason).toBe(`${r.signals[0].detail}; ${r.signals[1].detail}`);
    expect(r.signals[0].id).toBe("disposable_domain");
    expect(r.signals[1].id).toBe("no_mx");
  });
  it("reason with a single signal has no separator", async () => {
    const r = await runChecks(input({ user_agent: "" }), ctx());
    expect(r.reason).toBe("User agent is missing");
  });

  it("decides from thresholds: allow < challenge ≤ … < block", async () => {
    // bot UA = 30, dot alias = 5, plus alias = 10 → 45
    const base = (n: number) => ({ email: `m.a.r${"abcd"[n]}+x@gmail.com`, user_agent: "curl/8", ip: `2.2.2.${n}` });
    const r = await runChecks(input(base(0)), ctx());
    expect(r.score).toBe(45);
    expect(r.decision).toBe("challenge");
    expect((await runChecks(input({ ...base(1) }), ctx({ thresholds: { challenge: 46, block: 80 } }))).decision).toBe("allow");
    expect((await runChecks(input({ ...base(2) }), ctx({ thresholds: { challenge: 20, block: 45 } }))).decision).toBe("block");
    expect((await runChecks(input({ ...base(3) }), ctx({ thresholds: { challenge: 20, block: 46 } }))).decision).toBe("challenge");
  });
  it("custom thresholds apply exactly at the boundary", async () => {
    const t = { challenge: 30, block: 30 };
    expect((await runChecks(input({ user_agent: "" }), ctx({ thresholds: t }))).decision).toBe("block");
  });
});

describe("dryRun", () => {
  it("never records but scores like the real call", async () => {
    const hit = vi.spyOn(counters, "hit");
    // two real checks then a dry one: dry run sees the third
    await runChecks(input({ email: "aa.bb@example.com" }), ctx());
    await runChecks(input({ email: "cc.dd@example.com" }), ctx());
    hit.mockClear();
    const dry = await runChecks(input({ email: "ee.ff@example.com" }), ctx({ dryRun: true }));
    expect(hit).not.toHaveBeenCalled();
    expect(dry.signals.find((s) => s.id === "ip_velocity")?.points).toBe(45);
    // and it really did not record: the next real check is the third, not the fourth
    const real = await runChecks(input({ email: "gg.hh@example.com" }), ctx());
    expect(real.signals.find((s) => s.id === "ip_velocity")?.detail).toBe("3 checks from this IP in 24h");
  });
  it("detects email reuse without recording", async () => {
    await runChecks(input(), ctx());
    const dry = await runChecks(input(), ctx({ dryRun: true }));
    expect(ids(dry)).toContain("email_reuse");
    expect(await counters.count("gk:p1:em:maria.garcia@example.com", 86_400)).toBe(1);
  });
  it("a first dry run of a fresh email is clean and leaves counters empty", async () => {
    const r = await runChecks(input(), ctx({ dryRun: true }));
    expect(r.signals).toEqual([]);
    expect(await counters.count("gk:p1:ip:1.2.3.4", 86_400)).toBe(0);
    expect(await counters.count("gk:p1:burst", 600)).toBe(0);
  });
});

describe("fail open on dependency errors", () => {
  it("drops counter-based signals when counters throw", async () => {
    const broken: Counters = {
      hit: async () => {
        throw new Error("redis down");
      },
      count: async () => {
        throw new Error("redis down");
      },
    };
    const r = await runChecks(input({ email: "x@mailinator.com" }), ctx({ counters: broken }));
    expect(ids(r)).toEqual(["disposable_domain"]);
  });
});

describe("project isolation", () => {
  it("namespaces counters by project", async () => {
    for (let i = 0; i < 4; i++) await runChecks(input({ email: `pers${i}on@example.com` }), ctx({ projectId: "other" }));
    expect(ids(await runChecks(input(), ctx()))).not.toContain("ip_velocity");
  });
});

describe("parallelism", () => {
  it("starts MX and counter lookups before any of them resolves", async () => {
    const order: string[] = [];
    const slow: Counters = {
      hit: async (k) => (order.push(`hit:${k}`), await Promise.resolve(1)),
      count: async (k) => (order.push(`count:${k}`), await Promise.resolve(0)),
    };
    const mx = vi.fn(async () => (order.push("mx"), true));
    await runChecks(input({ device_id: "d" }), ctx({ counters: slow, resolveMx: mx }));
    expect(order.length).toBeGreaterThanOrEqual(6);
    expect(order[0]).toBe("mx");
  });
});

describe("untrusted input types", () => {
  it.each([
    ["name", { name: 123 }],
    ["ip", { ip: 5 }],
    ["user_agent", { user_agent: 5 }],
    ["device_id", { device_id: {} }],
    ["all of them", { name: [], ip: 1, user_agent: false, device_id: 7 }],
  ])("does not throw on non-string %s", async (_label, over) => {
    const r = await runChecks(input(over as unknown as Partial<CheckInput>), ctx());
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  it("treats a non-string user agent and a non-string ip as absent", async () => {
    const r = await runChecks(input({ user_agent: 5 as unknown as string, ip: 5 as unknown as string }), ctx());
    expect(ids(r)).toEqual([]);
  });
  it("does not flag a user agent the caller did not send (server-side integrations)", async () => {
    const r = await runChecks(input({ email: "jane.doe@gmail.com", user_agent: undefined }), ctx());
    expect(ids(r)).toEqual(["dot_alias"]);
    expect(r.decision).toBe("allow");
  });
  it("non-string email is invalid", async () => {
    expect((await runChecks(input({ email: 5 as unknown as string }), ctx())).decision).toBe("block");
  });
});

describe("degraded", () => {
  it("is absent when everything works", async () => {
    expect("degraded" in (await runChecks(input(), ctx()))).toBe(false);
  });
  it("reports mx_error when resolveMx rejects", async () => {
    resolveMx.mockRejectedValue(new Error("dns"));
    const r = await runChecks(input(), ctx());
    expect(r.degraded).toEqual(["mx_error"]);
    expect(r.decision).toBe("allow");
  });
  it("a null MX answer is unknown, not degraded", async () => {
    resolveMx.mockResolvedValue(null);
    expect((await runChecks(input(), ctx())).degraded).toBeUndefined();
  });
  it("reports counters_error when counters reject", async () => {
    const broken: Counters = {
      hit: async () => {
        throw new Error("redis");
      },
      count: async () => {
        throw new Error("redis");
      },
    };
    expect((await runChecks(input(), ctx({ counters: broken }))).degraded).toEqual(["counters_error"]);
  });
  it("reports both, sorted, in dryRun too", async () => {
    resolveMx.mockRejectedValue(new Error("dns"));
    const broken: Counters = {
      hit: async () => {
        throw new Error("x");
      },
      count: async () => {
        throw new Error("x");
      },
    };
    const r = await runChecks(input(), ctx({ counters: broken, dryRun: true }));
    expect(r.degraded).toEqual(["counters_error", "mx_error"]);
  });
});

describe("IDN domains", () => {
  it("passes the punycode domain to resolveMx and uses it as the key and email_domain", async () => {
    const r = await runChecks(input({ email: "jörg@münchen.de" }), ctx());
    expect(resolveMx).toHaveBeenCalledWith("xn--mnchen-3ya.de");
    expect(r.email_domain).toBe("xn--mnchen-3ya.de");
    expect(r.normalized_email).toBe("jörg@xn--mnchen-3ya.de");
  });
  it("detects reuse across Unicode and punycode spellings", async () => {
    await runChecks(input({ email: "jörg@münchen.de" }), ctx());
    const r = await runChecks(input({ email: "jörg@xn--mnchen-3ya.de", ip: "6.6.6.6" }), ctx());
    expect(ids(r)).toContain("email_reuse");
  });
  it("matches the disposable list on the ASCII form", async () => {
    const r = await runChecks(input({ email: "x@MAILINATOR.com" }), ctx());
    expect(ids(r)).toContain("disposable_domain");
  });
});
