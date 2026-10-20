import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../store/memory";
import type { Project } from "../types";
import { applyStripeEvent } from "./webhook";
import { PRO_PRICE, SCALE_PRICE, checkoutSession, stripeEvent, subscription } from "./test-helpers";

let store: MemoryStore;
let project: Project;
const get = async () => (await store.getProject(project.id))!;
const sub = (over: Record<string, unknown> = {}) =>
  subscription({ metadata: { project_id: project.id }, ...over });

beforeEach(async () => {
  vi.stubEnv("STRIPE_PRICE_PRO", PRO_PRICE);
  vi.stubEnv("STRIPE_PRICE_SCALE", SCALE_PRICE);
  store = new MemoryStore();
  project = await store.createProject("owner", "Acme");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkout.session.completed", () => {
  it("links the customer and subscription without choosing a plan", async () => {
    const r = await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ metadata: { project_id: project.id } })),
      store,
    );
    expect(r.changed).toBe(true);
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  });

  it("falls back to client_reference_id, then to the customer id", async () => {
    await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: project.id })),
      store,
    );
    expect((await get()).stripe_customer_id).toBe("cus_1");

    const other = await store.createProject("owner", "Other");
    await store.setBilling(other.id, { plan: "free", stripe_customer_id: "cus_2" });
    await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ customer: "cus_2", subscription: "sub_9" })),
      store,
    );
    expect((await store.getProject(other.id))?.stripe_subscription_id).toBe("sub_9");
  });

  it("accepts a fully discounted checkout but not an unpaid one or a non-subscription one", async () => {
    const free = await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: project.id, payment_status: "no_payment_required" })),
      store,
    );
    expect(free.changed).toBe(true);

    const other = await store.createProject("owner", "Other");
    const unpaid = await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: other.id, payment_status: "unpaid" })),
      store,
    );
    expect(unpaid.changed).toBe(false);
    const payment = await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: other.id, mode: "payment" })),
      store,
    );
    expect(payment.handled).toBe(false);
    expect((await store.getProject(other.id))?.stripe_customer_id).toBeNull();
  });
});

describe("customer.subscription.created / updated", () => {
  it.each([
    ["active", PRO_PRICE, "pro"],
    ["trialing", PRO_PRICE, "pro"],
    ["past_due", SCALE_PRICE, "scale"],
  ])("%s on %s grants %s", async (status, price, plan) => {
    const r = await applyStripeEvent(
      stripeEvent("customer.subscription.created", sub({ status, items: { data: [{ price: { id: price } }] } })),
      store,
    );
    expect(r.changed).toBe(true);
    expect(await get()).toMatchObject({ plan, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  });

  it.each(["unpaid", "incomplete", "paused"])("%s drops to free but keeps the subscription id", async (status) => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    await applyStripeEvent(stripeEvent("customer.subscription.updated", sub({ status })), store);
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: "sub_1" });
  });

  it.each(["canceled", "incomplete_expired"])("%s drops to free and clears the subscription id", async (status) => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    await applyStripeEvent(stripeEvent("customer.subscription.updated", sub({ status })), store);
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: null });
  });

  it("follows a plan change on the same subscription", async () => {
    await applyStripeEvent(stripeEvent("customer.subscription.created", sub()), store);
    await applyStripeEvent(
      stripeEvent("customer.subscription.updated", sub({ items: { data: [{ price: { id: SCALE_PRICE } }] } })),
      store,
    );
    expect((await get()).plan).toBe("scale");
    await applyStripeEvent(stripeEvent("customer.subscription.updated", sub()), store);
    expect((await get()).plan).toBe("pro");
  });

  it("takes the highest plan when several items are present", async () => {
    await applyStripeEvent(
      stripeEvent("customer.subscription.updated", sub({ items: { data: [{ price: { id: PRO_PRICE } }, { price: { id: SCALE_PRICE } }] } })),
      store,
    );
    expect((await get()).plan).toBe("scale");
  });

  it("never trusts a plan name in metadata, only price ids", async () => {
    const r = await applyStripeEvent(
      stripeEvent("customer.subscription.created", sub({ metadata: { project_id: project.id, plan: "scale" }, items: { data: [{ price: { id: "price_unknown" } }] } })),
      store,
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("unknown price");
    expect((await get()).plan).toBe("free");
  });

  it("does not downgrade a paying project when the price is unknown", async () => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    await applyStripeEvent(
      stripeEvent("customer.subscription.updated", sub({ items: { data: [{ price: { id: "price_unknown" } }] } })),
      store,
    );
    expect((await get()).plan).toBe("pro");
  });

  it("finds the project by customer id when metadata is missing", async () => {
    await store.setBilling(project.id, { plan: "free", stripe_customer_id: "cus_1" });
    await applyStripeEvent(stripeEvent("customer.subscription.created", subscription()), store);
    expect((await get()).plan).toBe("pro");
  });

  it("prefers metadata.project_id over the customer id", async () => {
    const other = await store.createProject("owner", "Other");
    await store.setBilling(other.id, { plan: "free", stripe_customer_id: "cus_1" });
    await applyStripeEvent(stripeEvent("customer.subscription.created", sub()), store);
    expect((await get()).plan).toBe("pro");
    expect((await store.getProject(other.id))?.plan).toBe("free");
  });

  it("ignores events for projects it cannot find", async () => {
    const r = await applyStripeEvent(
      stripeEvent("customer.subscription.created", subscription({ customer: "cus_nobody" })),
      store,
    );
    expect(r).toMatchObject({ handled: true, changed: false, reason: "no matching project" });
  });

  it("reads an expanded customer object", async () => {
    await applyStripeEvent(
      stripeEvent("customer.subscription.created", sub({ customer: { id: "cus_7", object: "customer" } })),
      store,
    );
    expect((await get()).stripe_customer_id).toBe("cus_7");
  });
});

describe("customer.subscription.deleted", () => {
  beforeEach(async () => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  });

  it("downgrades to free and clears the subscription id, keeping the customer", async () => {
    const r = await applyStripeEvent(stripeEvent("customer.subscription.deleted", sub({ status: "canceled" })), store);
    expect(r.changed).toBe(true);
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: null });
  });

  it("ignores the deletion of an older subscription", async () => {
    await applyStripeEvent(stripeEvent("customer.subscription.deleted", sub({ id: "sub_old", status: "canceled" })), store);
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_1" });
  });
});

describe("replacing a subscription", () => {
  it("a dead old subscription cannot downgrade the new one", async () => {
    await store.setBilling(project.id, { plan: "scale", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_new" });
    await applyStripeEvent(stripeEvent("customer.subscription.updated", sub({ id: "sub_old", status: "canceled" })), store);
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_new" });
  });

  it("a new active subscription takes over", async () => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_old" });
    await applyStripeEvent(
      stripeEvent("customer.subscription.created", sub({ id: "sub_new", items: { data: [{ price: { id: SCALE_PRICE } }] } })),
      store,
    );
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_new" });
  });

  it("checkout.session.completed does not overwrite an existing subscription id", async () => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_current" });
    await applyStripeEvent(
      stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: project.id, subscription: "sub_other" })),
      store,
    );
    expect((await get()).stripe_subscription_id).toBe("sub_current");
  });
});

describe("idempotency and unknown events", () => {
  it("applying the same event twice writes once", async () => {
    const spy = vi.spyOn(store, "setBilling");
    const event = stripeEvent("customer.subscription.created", sub());
    const first = await applyStripeEvent(event, store);
    const second = await applyStripeEvent(event, store);
    expect(first.changed).toBe(true);
    expect(second).toMatchObject({ handled: true, changed: false, reason: "already up to date" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await get()).plan).toBe("pro");
  });

  it("replaying checkout.session.completed and subscription.deleted is stable", async () => {
    const checkout = stripeEvent("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    await applyStripeEvent(checkout, store);
    await applyStripeEvent(checkout, store);
    const del = stripeEvent("customer.subscription.deleted", sub());
    await applyStripeEvent(del, store);
    const again = await applyStripeEvent(del, store);
    expect(again.changed).toBe(false);
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it.each(["invoice.paid", "customer.created", "charge.refunded", "payment_intent.succeeded"])(
    "ignores %s",
    async (type) => {
      const spy = vi.spyOn(store, "setBilling");
      const r = await applyStripeEvent(stripeEvent(type, { id: "x", customer: "cus_1", metadata: { project_id: project.id } }), store);
      expect(r).toMatchObject({ handled: false, changed: false });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("propagates store failures so the route can answer 500 and Stripe retries", async () => {
    vi.spyOn(store, "setBilling").mockRejectedValueOnce(new Error("db down"));
    await expect(applyStripeEvent(stripeEvent("customer.subscription.created", sub()), store)).rejects.toThrow("db down");
  });
});
