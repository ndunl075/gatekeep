import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { MemoryStore, defaultProject } from "../store/memory";
import {
  BillingError,
  billingAvailability,
  createCheckoutSession,
  createPortalSession,
  getStripe,
  planForPriceId,
  priceIdForPlan,
} from "./stripe";

afterEach(() => vi.unstubAllEnvs());

describe("price <-> plan mapping", () => {
  it("maps plans to the configured price ids and back", () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
    vi.stubEnv("STRIPE_PRICE_SCALE", "price_s");
    expect(priceIdForPlan("pro")).toBe("price_p");
    expect(priceIdForPlan("scale")).toBe("price_s");
    expect(priceIdForPlan("free")).toBeNull();
    expect(planForPriceId("price_p")).toBe("pro");
    expect(planForPriceId("price_s")).toBe("scale");
    expect(planForPriceId("price_other")).toBeNull();
  });

  it("never maps empty or missing ids, even when env vars are unset", () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    vi.stubEnv("STRIPE_PRICE_SCALE", "");
    expect(priceIdForPlan("pro")).toBeNull();
    expect(planForPriceId("")).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
    expect(planForPriceId(null)).toBeNull();
  });

  it("reports availability", () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
    vi.stubEnv("STRIPE_PRICE_SCALE", "");
    expect(billingAvailability().prices).toEqual({ pro: true, scale: false });
    expect(billingAvailability().configured).toBe(false); // no STRIPE_SECRET_KEY in the test env
  });
});

describe("getStripe", () => {
  it("is null without STRIPE_SECRET_KEY", () => {
    expect(getStripe()).toBeNull();
  });
});

function fakeStripe() {
  const customers = { create: vi.fn(async () => ({ id: "cus_new" })) };
  const sessions = { create: vi.fn(async () => ({ url: "https://checkout.stripe.test/s" })) };
  const portal = { create: vi.fn(async () => ({ url: "https://portal.stripe.test/p" })) };
  const stripe = { customers, checkout: { sessions }, billingPortal: { sessions: portal } };
  return { stripe: stripe as unknown as Stripe, customers, sessions, portal };
}

describe("createCheckoutSession", () => {
  const setup = async () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
    vi.stubEnv("STRIPE_PRICE_SCALE", "price_s");
    const store = new MemoryStore();
    const project = await store.createProject("owner", "Acme");
    return { store, project, ...fakeStripe() };
  };

  it("creates a customer, persists it, and builds a subscription session", async () => {
    const { store, project, stripe, customers, sessions } = await setup();
    const url = await createCheckoutSession(project, "pro", { stripe, store, appUrl: "https://app.test/" });
    expect(url).toBe("https://checkout.stripe.test/s");
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect((await store.getProject(project.id))?.stripe_customer_id).toBe("cus_new");
    expect((await store.getProject(project.id))?.plan).toBe("free"); // checkout alone never upgrades

    const params = (sessions.create.mock.calls[0] as unknown[])[0];
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_new",
      line_items: [{ price: "price_p", quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: project.id,
      metadata: { project_id: project.id },
      subscription_data: { metadata: { project_id: project.id } },
      success_url: "https://app.test/dashboard/billing?status=success",
      cancel_url: "https://app.test/dashboard/billing",
    });
  });

  it("uses the scale price for the scale plan", async () => {
    const { store, project, stripe, sessions } = await setup();
    await createCheckoutSession(project, "scale", { stripe, store });
    expect((sessions.create.mock.calls[0] as unknown[])[0]).toMatchObject({ line_items: [{ price: "price_s" }] });
  });

  it("reuses an existing customer", async () => {
    const { store, project, stripe, customers, sessions } = await setup();
    const withCustomer = await store.setBilling(project.id, { plan: "free", stripe_customer_id: "cus_old" });
    await createCheckoutSession(withCustomer, "pro", { stripe, store });
    expect(customers.create).not.toHaveBeenCalled();
    expect((sessions.create.mock.calls[0] as unknown[])[0]).toMatchObject({ customer: "cus_old" });
  });

  it("replaces a customer that no longer exists in Stripe", async () => {
    const { store, project, stripe, customers, sessions } = await setup();
    const stale = await store.setBilling(project.id, { plan: "free", stripe_customer_id: "cus_gone" });
    sessions.create.mockRejectedValueOnce(Object.assign(new Error("No such customer"), { code: "resource_missing" }));
    await createCheckoutSession(stale, "pro", { stripe, store });
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect((await store.getProject(project.id))?.stripe_customer_id).toBe("cus_new");
    expect(sessions.create).toHaveBeenCalledTimes(2);
  });

  it("does not swallow other Stripe errors", async () => {
    const { store, project, stripe, sessions } = await setup();
    sessions.create.mockRejectedValueOnce(new Error("boom"));
    await expect(createCheckoutSession(project, "pro", { stripe, store })).rejects.toThrow("boom");
  });

  it("refuses a second subscription", async () => {
    const { store, project, stripe, sessions } = await setup();
    const subscribed = { ...project, plan: "pro" as const, stripe_subscription_id: "sub_1" };
    await expect(createCheckoutSession(subscribed, "scale", { stripe, store })).rejects.toMatchObject({
      code: "already_subscribed",
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("rejects free, missing prices and a missing Stripe client", async () => {
    const { store, project, stripe } = await setup();
    await expect(createCheckoutSession(project, "free", { stripe, store })).rejects.toMatchObject({ code: "bad_plan" });
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    await expect(createCheckoutSession(project, "pro", { stripe, store })).rejects.toMatchObject({ code: "no_price" });
    await expect(createCheckoutSession(project, "pro", { stripe: null, store })).rejects.toBeInstanceOf(BillingError);
  });
});

describe("createPortalSession", () => {
  it("opens the portal for the project's customer and returns to the billing page", async () => {
    const { stripe, portal } = fakeStripe();
    const project = { ...defaultProject("o", "Acme"), stripe_customer_id: "cus_1" };
    expect(await createPortalSession(project, { stripe, appUrl: "https://app.test" })).toBe("https://portal.stripe.test/p");
    expect(portal.create).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.test/dashboard/billing" });
  });

  it("needs a customer and a Stripe client", async () => {
    const { stripe } = fakeStripe();
    await expect(createPortalSession(defaultProject("o", "Acme"), { stripe })).rejects.toMatchObject({ code: "no_customer" });
    await expect(createPortalSession(defaultProject("o", "Acme"), { stripe: null })).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});
