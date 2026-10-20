import { beforeEach, describe, expect, it, vi } from "vitest";

// No network: every domain "has mail".
vi.mock("@/lib/mx", () => ({ resolveMx: async () => true }));

import { DEMO_API_KEY } from "@/lib/demo";
import { GET, POST } from "./route";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";

function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${DEMO_API_KEY}` }, raw?: string) {
  return POST(
    new Request("http://localhost/api/v1/check", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/v1/check (demo store)", () => {
  it("returns a CheckResult with no-store and latency headers", async () => {
    const res = await post({ email: "burner@mailinator.com", ip: "198.51.100.77", user_agent: UA });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("x-gatekeep-latency"))).toBeGreaterThanOrEqual(0);
    const body = await res.json();
    expect(body).toMatchObject({ decision: "block", normalized_email: "burner@mailinator.com" });
    expect(body.signals[0]).toMatchObject({ id: "disposable_domain" });
    expect(typeof body.id).toBe("string");
    expect(typeof body.latency_ms).toBe("number");
  });

  it("accepts x-api-key", async () => {
    const res = await post({ email: "maya@northwind.io", ip: "198.51.100.78", user_agent: UA }, { "x-api-key": DEMO_API_KEY });
    expect(res.status).toBe(200);
  });

  it("401 without a key, with a wrong key", async () => {
    const none = await post({ email: "a@b.co" }, {});
    expect(none.status).toBe(401);
    expect(none.headers.get("cache-control")).toBe("no-store");
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await post({ email: "a@b.co" }, { authorization: "Bearer gk_live_nope" })).status).toBe(401);
  });

  it("400 for a body that is not JSON", async () => {
    const res = await post(null, undefined, "email=a@b.co");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("400 for a JSON body without an email", async () => {
    const res = await post({ ip: "1.2.3.4" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/email/);
  });

  it("413 for an oversized body", async () => {
    const res = await post({ email: "a@b.co", name: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it("413 from Content-Length alone, before reading anything", async () => {
    const res = await post(null, { authorization: `Bearer ${DEMO_API_KEY}`, "content-length": "999999" }, "{}");
    expect(res.status).toBe(413);
  });

  it("413 for a chunked body that grows past the cap, and stops reading", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(4096).fill(97));
        if (pulled > 1000) controller.close();
      },
    });
    const res = await POST(
      new Request("http://localhost/api/v1/check", {
        method: "POST",
        headers: { authorization: `Bearer ${DEMO_API_KEY}` },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("400 for an empty body", async () => {
    const res = await post(null, undefined, "");
    expect(res.status).toBe(400);
  });

  it("405 with Allow for other methods", async () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
