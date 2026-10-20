import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() }));
const ctor = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    constructor(...args: unknown[]) {
      ctor.args.push(args);
    }
    resolveMx = dns.resolveMx;
    resolve4 = dns.resolve4;
    resolve6 = dns.resolve6;
  },
}));

import { clearMxCache, resolveMx } from "./mx";

const dnsError = (code: string) => Object.assign(new Error(code), { code });

/** Per-domain answers; anything else (incl. the gmail.com canary) has an MX. */
function mockDns(overrides: Record<string, () => unknown>) {
  dns.resolveMx.mockImplementation(async (d: string) =>
    d in overrides ? overrides[d]() : [{ exchange: `mx.${d}`, priority: 10 }],
  );
}

beforeEach(() => {
  clearMxCache();
  vi.useRealTimers();
  dns.resolveMx.mockReset();
  dns.resolve4.mockReset().mockRejectedValue(dnsError("ENODATA"));
  dns.resolve6.mockReset().mockRejectedValue(dnsError("ENODATA"));
});
afterEach(() => vi.useRealTimers());

describe("resolveMx", () => {
  it("uses one dedicated resolver with its own 1500ms timeout and a single try", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    await resolveMx("a.example");
    await resolveMx("b.example");
    expect(ctor.args).toEqual([[{ timeout: 1500, tries: 1 }]]);
  });

  it("true when the domain has MX records", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    expect(await resolveMx("example.com")).toBe(true);
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it("falls back to A records (implicit MX) on ENODATA", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ENODATA"));
    dns.resolve4.mockResolvedValue(["192.0.2.1"]);
    expect(await resolveMx("a-only.example")).toBe(true);
  });

  it("falls back to AAAA when there is no A", async () => {
    dns.resolveMx.mockResolvedValue([]);
    dns.resolve6.mockResolvedValue(["2001:db8::1"]);
    expect(await resolveMx("v6.example")).toBe(true);
  });

  it("false for NXDOMAIN (ENOTFOUND everywhere)", async () => {
    mockDns({ "nope.example": () => Promise.reject(dnsError("ENOTFOUND")) });
    dns.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve6.mockRejectedValue(dnsError("ENOTFOUND"));
    expect(await resolveMx("nope.example")).toBe(false);
  });

  it("null, not false, when the resolver says ENOTFOUND for everything (canary fails)", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve6.mockRejectedValue(dnsError("ENOTFOUND"));
    expect(await resolveMx("real-company.example")).toBeNull();
  });

  it("checks the canary once, not once per false answer", async () => {
    const gone = () => Promise.reject(dnsError("ENOTFOUND"));
    mockDns({ "a.example": gone, "b.example": gone, "c.example": gone });
    dns.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dns.resolve6.mockRejectedValue(dnsError("ENOTFOUND"));
    for (const d of ["a.example", "b.example", "c.example"]) expect(await resolveMx(d)).toBe(false);
    expect(dns.resolveMx.mock.calls.filter(([d]) => d === "gmail.com")).toHaveLength(1);
  });

  it("false for a null MX (RFC 7505)", async () => {
    mockDns({ "nomail.example": async () => [{ exchange: ".", priority: 0 }] });
    expect(await resolveMx("nomail.example")).toBe(false);
  });

  it("null (unknown) on other resolver errors, never throws", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ESERVFAIL"));
    expect(await resolveMx("broken.example")).toBeNull();
  });

  it("null when the fallback lookup fails for a reason other than no records", async () => {
    dns.resolveMx.mockRejectedValue(dnsError("ENODATA"));
    dns.resolve4.mockRejectedValue(dnsError("ETIMEOUT"));
    expect(await resolveMx("flaky.example")).toBeNull();
  });

  it("null after 1500ms", async () => {
    vi.useFakeTimers();
    dns.resolveMx.mockReturnValue(new Promise(() => {}));
    const p = resolveMx("slow.example");
    await vi.advanceTimersByTimeAsync(1499);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
  });

  it("caches true/false for an hour and null for five minutes", async () => {
    vi.useFakeTimers();
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.ok.example", priority: 1 }]);
    await resolveMx("ok.example");
    await resolveMx("OK.example.");
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    await resolveMx("ok.example");
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await resolveMx("ok.example");
    expect(dns.resolveMx).toHaveBeenCalledTimes(2);

    dns.resolveMx.mockRejectedValue(dnsError("ESERVFAIL"));
    expect(await resolveMx("unk.example")).toBeNull();
    const calls = dns.resolveMx.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await resolveMx("unk.example");
    expect(dns.resolveMx).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await resolveMx("unk.example");
    expect(dns.resolveMx).toHaveBeenCalledTimes(calls + 1);
  });

  it("shares one lookup between concurrent callers", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.x.example", priority: 1 }]);
    await Promise.all([resolveMx("x.example"), resolveMx("x.example"), resolveMx("x.example")]);
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest entries beyond ~5000", async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: "mx.example", priority: 1 }]);
    for (let i = 0; i < 5001; i++) await resolveMx(`d${i}.example`);
    dns.resolveMx.mockClear();
    await resolveMx("d0.example"); // evicted → looked up again
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
    await resolveMx("d5000.example"); // newest → still cached
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
  });

  it("null for an empty domain", async () => {
    expect(await resolveMx("  ")).toBeNull();
  });
});
