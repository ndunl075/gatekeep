import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, defaultProject } from "../store/memory";
import { makeFakeStripe, subscription } from "./test-helpers";
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

const live = (over: Record<string, unknown> = {}) => subscription({ customer: "cus_old", ...over });

describe("createCheckoutSession", () => {
  const setup = async (pageSize = 100) => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_p");
    vi.stubEnv("STRIPE_PRICE_SCALE", "price_s");
    const store = new MemoryStore();
    const project = await store.createProject("owner", "Acme");
    const fake = makeFakeStripe(pageSize);
    const existing = async () => store.setBilling(project.id, { stripe_customer_id: "cus_old" });
    return { store, project, fake, stripe: fake.client, existing };
  };

  it("creates a customer, persists it, and builds a subscription session", async () => {
    const { store, project, stripe, fake } = await setup();
    const url = await createCheckoutSession(project, "pro", { stripe, store, appUrl: "https://app.test/" });
    expect(fake.api.customers.create).toHaveBeenCalledTimes(1);
    const customer = fake.state.customers[0].id;
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect((await store.getProject(project.id))?.stripe_customer_id).toBe(customer);
    expect((await store.getProject(project.id))?.plan).toBe("free"); // checkout alone never upgrades

    expect(fake.api.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
      mode: "subscription",
      customer,
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
    const { store, project, stripe, fake } = await setup();
    await createCheckoutSession(project, "scale", { stripe, store });
    expect(fake.api.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ line_items: [{ price: "price_s" }] });
  });

  it("reuses an existing customer", async () => {
    const { store, stripe, fake, existing } = await setup();
    await createCheckoutSession(await existing(), "pro", { stripe, store });
    expect(fake.api.customers.create).not.toHaveBeenCalled();
    expect(fake.api.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ customer: "cus_old" });
  });

  it("persists only the customer id, never a plan read earlier in the request", async () => {
    const { store, project, stripe } = await setup();
    const spy = vi.spyOn(store, "setBilling");
    await createCheckoutSession({ ...project, plan: "scale" }, "pro", { stripe, store });
    expect(spy).toHaveBeenCalledWith(project.id, { stripe_customer_id: expect.stringMatching(/^cus_new/) });
    expect((await store.getProject(project.id))?.plan).toBe("free");
  });

  it("does not list anything for a brand new customer", async () => {
    const { store, project, stripe, fake } = await setup();
    await createCheckoutSession(project, "pro", { stripe, store });
    expect(fake.api.subscriptions.list).not.toHaveBeenCalled();
    expect(fake.api.checkout.sessions.list).not.toHaveBeenCalled();
  });

  describe("existing subscription guard (asks Stripe, never the database)", () => {
    it.each(["active", "trialing", "past_due", "incomplete", "unpaid", "paused"])("refuses on %s", async (status) => {
      const { store, stripe, fake, existing } = await setup();
      fake.state.subs = [live({ id: "sub_x", status })] as never;
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).rejects.toMatchObject({
        code: "already_subscribed",
      });
      expect(fake.api.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("allows checkout when the customer only has dead subscriptions", async () => {
      const { store, stripe, fake, existing } = await setup();
      fake.state.subs = [live({ id: "a", status: "canceled" }), live({ id: "b", status: "incomplete_expired" })] as never;
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).resolves.toContain("checkout.stripe.test");
    });

    it("sees a live subscription behind 25 newer dead ones (several pages)", async () => {
      const { store, stripe, fake, existing } = await setup(10);
      fake.state.subs = [
        ...Array.from({ length: 25 }, (_, i) => live({ id: `dead_${i}`, status: "incomplete_expired" })),
        live({ id: "sub_old", status: "active" }),
      ] as never;
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).rejects.toMatchObject({
        code: "already_subscribed",
      });
      expect(fake.api.subscriptions.list.mock.calls.length).toBe(3);
    });

    it("does not trust project.stripe_subscription_id in the database", async () => {
      const { store, project, stripe, fake } = await setup();
      const stale = await store.setBilling(project.id, { stripe_customer_id: "cus_old", stripe_subscription_id: "sub_gone" });
      fake.state.subs = [live({ id: "sub_gone", status: "canceled" })] as never;
      await expect(createCheckoutSession(stale, "pro", { stripe, store })).resolves.toContain("checkout.stripe.test");

      // and the other way round: a live Stripe subscription blocks even when the database lost track of it
      fake.state.subs = [live({ id: "sub_unknown", status: "active" })] as never;
      await expect(createCheckoutSession(await store.setBilling(project.id, { stripe_subscription_id: null }), "pro", { stripe, store })).rejects.toMatchObject({ code: "already_subscribed" });
    });
  });

  describe("two Checkout tabs", () => {
    it("expires every open session before creating a new one", async () => {
      const { store, stripe, fake, existing } = await setup();
      fake.state.sessions = [
        { id: "cs_a", url: "u", customer: "cus_old", status: "open" },
        { id: "cs_b", url: "u", customer: "cus_old", status: "open" },
        { id: "cs_done", url: "u", customer: "cus_old", status: "complete" },
      ];
      await createCheckoutSession(await existing(), "pro", { stripe, store });
      expect(fake.state.sessions.filter((s) => s.status === "open")).toHaveLength(1); // only the new one
      expect(fake.api.checkout.sessions.expire).toHaveBeenCalledTimes(2);
      expect(fake.state.sessions.find((s) => s.id === "cs_done")?.status).toBe("complete");
    });

    it("clicking twice leaves exactly one payable session", async () => {
      const { store, stripe, fake, existing } = await setup();
      const project = await existing();
      const first = await createCheckoutSession(project, "pro", { stripe, store });
      const second = await createCheckoutSession(project, "scale", { stripe, store });
      const open = fake.state.sessions.filter((s) => s.status === "open");
      expect(open).toHaveLength(1);
      expect(second).toBe(open[0].url);
      expect(first).not.toBe(second);
    });

    it("tolerates a session that completed or expired in the meantime", async () => {
      const { store, stripe, fake, existing } = await setup();
      fake.state.sessions = [{ id: "cs_a", url: "u", customer: "cus_old", status: "open" }];
      fake.api.checkout.sessions.expire.mockRejectedValueOnce(
        Object.assign(new Error("not open"), { type: "StripeInvalidRequestError" }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).resolves.toContain("checkout.stripe.test");
    });

    it("fails the checkout if a session cannot be expired for a real reason", async () => {
      const { store, stripe, fake, existing } = await setup();
      fake.state.sessions = [{ id: "cs_a", url: "u", customer: "cus_old", status: "open" }];
      fake.api.checkout.sessions.expire.mockRejectedValueOnce(new Error("stripe down"));
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).rejects.toThrow("stripe down");
      expect(fake.api.checkout.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe("a stored customer that no longer exists in Stripe", () => {
    it("is replaced when the subscription list says resource_missing", async () => {
      const { store, project, stripe, fake, existing } = await setup();
      fake.state.missingCustomers.add("cus_old");
      await createCheckoutSession(await existing(), "pro", { stripe, store });
      expect(fake.api.customers.create).toHaveBeenCalledTimes(1);
      const after = await store.getProject(project.id);
      expect(after?.stripe_customer_id).toBe(fake.state.customers[0].id);
      expect(after?.stripe_customer_id).not.toBe("cus_old");
      // the replacement customer gets a fresh idempotency key, not the replayable first one
      expect(fake.api.customers.create.mock.calls[0][1]).toEqual({ idempotencyKey: expect.stringMatching(/^gatekeep-customer-.+-\d+$/) });
    });

    it("is replaced when only session creation notices", async () => {
      const { store, project, stripe, fake, existing } = await setup();
      fake.api.checkout.sessions.create.mockRejectedValueOnce(Object.assign(new Error("No such customer"), { code: "resource_missing" }));
      await createCheckoutSession(await existing(), "pro", { stripe, store });
      expect(fake.api.customers.create).toHaveBeenCalledTimes(1);
      expect((await store.getProject(project.id))?.stripe_customer_id).toBe(fake.state.customers[0].id);
    });

    it("gives up (no loop) if the brand new customer is also missing", async () => {
      const { store, stripe, fake, existing } = await setup();
      fake.api.checkout.sessions.create.mockRejectedValue(Object.assign(new Error("No such customer"), { code: "resource_missing" }));
      await expect(createCheckoutSession(await existing(), "pro", { stripe, store })).rejects.toThrow("No such customer");
      expect(fake.api.customers.create).toHaveBeenCalledTimes(1);
    });
  });

  it("does not swallow other Stripe errors", async () => {
    const { store, project, stripe, fake } = await setup();
    fake.api.checkout.sessions.create.mockRejectedValueOnce(new Error("boom"));
    await expect(createCheckoutSession(project, "pro", { stripe, store })).rejects.toThrow("boom");
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
    const fake = makeFakeStripe();
    const project = { ...defaultProject("o", "Acme"), stripe_customer_id: "cus_1" };
    expect(await createPortalSession(project, { stripe: fake.client, appUrl: "https://app.test" })).toBe("https://portal.stripe.test/p");
    expect(fake.api.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.test/dashboard/billing" });
  });

  it("needs a customer and a Stripe client", async () => {
    const { client } = makeFakeStripe();
    await expect(createPortalSession(defaultProject("o", "Acme"), { stripe: client })).rejects.toMatchObject({ code: "no_customer" });
    await expect(createPortalSession(defaultProject("o", "Acme"), { stripe: null })).rejects.toMatchObject({ code: "not_configured" });
  });
});
