import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
import type { Project } from "@/lib/types";
import { PRO_PRICE, stripeEvent, subscription } from "@/lib/billing/test-helpers";

const SECRET = "whsec_test_secret";
let store: MemoryStore;
let project: Project;

let stripeState: unknown[] = [];
let stripeOn = true;
vi.mock("@/lib/store", () => ({ getStore: () => store }));
vi.mock("@/lib/billing/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/stripe")>()),
  getStripe: () => (stripeOn ? { subscriptions: { list: async () => ({ data: stripeState }) } } : null),
}));

beforeEach(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("STRIPE_PRICE_PRO", PRO_PRICE);
  store = new MemoryStore();
  project = await store.createProject("owner", "Acme");
  stripeOn = true;
  stripeState = [subscription({ metadata: { project_id: project.id } })];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const signed = (payload: string, secret = SECRET) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret });

async function post(body: string, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers }));
}

const payload = () =>
  JSON.stringify(stripeEvent("customer.subscription.created", subscription({ metadata: { project_id: project.id } })));

describe("POST /api/stripe/webhook", () => {
  it("applies an event with a valid signature", async () => {
    const body = payload();
    const res = await post(body, { "stripe-signature": signed(body) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect((await store.getProject(project.id))?.plan).toBe("pro");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = payload();
    const res = await post(body, { "stripe-signature": signed(body, "whsec_other") });
    expect(res.status).toBe(400);
    expect((await store.getProject(project.id))?.plan).toBe("free");
  });

  it("rejects a body that was changed after signing", async () => {
    const body = payload();
    const header = signed(body);
    const res = await post(body.replace("sub_1", "sub_2"), { "stripe-signature": header });
    expect(res.status).toBe(400);
    expect((await store.getProject(project.id))?.plan).toBe("free");
  });

  it("rejects a stale timestamp", async () => {
    const body = payload();
    const old = Math.floor(Date.now() / 1000) - 3600;
    const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET, timestamp: old });
    expect((await post(body, { "stripe-signature": header })).status).toBe(400);
  });

  it("rejects a missing signature header and a garbage one", async () => {
    expect((await post(payload())).status).toBe(400);
    expect((await post(payload(), { "stripe-signature": "nonsense" })).status).toBe(400);
  });

  it("answers 503 when the webhook secret is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const body = payload();
    expect((await post(body, { "stripe-signature": signed(body) })).status).toBe(503);
  });

  it("answers 503 (so Stripe retries) when the API key is missing", async () => {
    stripeOn = false;
    const body = payload();
    expect((await post(body, { "stripe-signature": signed(body) })).status).toBe(503);
    expect((await store.getProject(project.id))?.plan).toBe("free");
  });

  it("answers 200 for event types it ignores", async () => {
    const body = JSON.stringify(stripeEvent("invoice.paid", { id: "in_1" }));
    expect((await post(body, { "stripe-signature": signed(body) })).status).toBe(200);
  });

  it("answers 500 when the Stripe API fails, so Stripe retries", async () => {
    stripeState = [];
    vi.doMock("@/lib/billing/stripe", async (orig) => ({
      ...(await orig<typeof import("@/lib/billing/stripe")>()),
      getStripe: () => ({ subscriptions: { list: async () => Promise.reject(new Error("stripe down")) } }),
    }));
    vi.resetModules();
    const { POST } = await import("./route");
    const body = payload();
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": signed(body) } }),
    );
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/billing/stripe");
  });

  it("answers 500 when the store fails, so Stripe retries", async () => {
    vi.spyOn(store, "setBilling").mockRejectedValueOnce(new Error("db down"));
    const body = payload();
    expect((await post(body, { "stripe-signature": signed(body) })).status).toBe(500);
  });
});
