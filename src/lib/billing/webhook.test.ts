import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { MemoryStore } from "../store/memory";
import type { Project } from "../types";
import { applyStripeEvent, type StripeSubscriptions } from "./webhook";
import { PRO_PRICE, SCALE_PRICE, checkoutSession, stripeEvent, subscription } from "./test-helpers";

let store: MemoryStore;
let project: Project;
/** What Stripe would answer right now. Events never carry the truth, this does. */
let stripeState: Stripe.Subscription[];
let list: ReturnType<typeof vi.fn>;
let stripe: StripeSubscriptions;

const get = async () => (await store.getProject(project.id))!;
const sub = (over: Record<string, unknown> = {}) =>
  subscription({ metadata: { project_id: project.id }, ...over }) as unknown as Stripe.Subscription;
const price = (id: string) => ({ data: [{ id: "si", price: { id } }] });
const apply = (type: string, object: unknown) => applyStripeEvent(stripeEvent(type, object), store, stripe);
const linked = () =>
  store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });

beforeEach(async () => {
  vi.stubEnv("STRIPE_PRICE_PRO", PRO_PRICE);
  vi.stubEnv("STRIPE_PRICE_SCALE", SCALE_PRICE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  store = new MemoryStore();
  project = await store.createProject("owner", "Acme");
  stripeState = [];
  list = vi.fn(async () => ({ data: stripeState }));
  stripe = { subscriptions: { list } } as unknown as StripeSubscriptions;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("every relevant event syncs from Stripe", () => {
  it.each([
    ["customer.subscription.created", () => sub()],
    ["customer.subscription.updated", () => sub()],
    ["customer.subscription.deleted", () => sub()],
    ["checkout.session.completed", () => checkoutSession({ metadata: { project_id: project.id } })],
  ])("%s", async (type, payload) => {
    stripeState = [sub()];
    const r = await apply(type, payload());
    expect(r.changed).toBe(true);
    expect(list).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 10 });
    expect(await get()).toMatchObject({ plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  });

  it("the payload never decides the plan: a deleted event with an active price payload still follows Stripe", async () => {
    await linked();
    stripeState = [sub({ status: "canceled" })];
    await apply("customer.subscription.deleted", sub({ status: "active" }));
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null, stripe_customer_id: "cus_1" });
  });

  it("deleted with no subscriptions left goes to free and keeps the customer", async () => {
    await linked();
    await apply("customer.subscription.deleted", sub({ status: "canceled" }));
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: null });
  });

  it("checkout.session.completed ignores non-subscription sessions without calling Stripe", async () => {
    const r = await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id, mode: "payment" }));
    expect(r.handled).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("plan from subscription status and price", () => {
  it.each([
    ["active", PRO_PRICE, "pro"],
    ["trialing", PRO_PRICE, "pro"],
    ["past_due", SCALE_PRICE, "scale"],
  ])("%s on %s grants %s", async (status, priceId, plan) => {
    stripeState = [sub({ status, items: price(priceId) })];
    await apply("customer.subscription.updated", sub());
    expect(await get()).toMatchObject({ plan, stripe_subscription_id: "sub_1" });
  });

  it.each(["unpaid", "incomplete", "paused", "canceled", "incomplete_expired"])("%s is free with no subscription id", async (status) => {
    await linked();
    stripeState = [sub({ status })];
    await apply("customer.subscription.updated", sub());
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it("follows a plan change on the same subscription", async () => {
    stripeState = [sub()];
    await apply("customer.subscription.created", sub());
    stripeState = [sub({ items: price(SCALE_PRICE) })];
    await apply("customer.subscription.updated", sub());
    expect((await get()).plan).toBe("scale");
  });

  it("takes the highest plan when several items are present", async () => {
    stripeState = [sub({ items: { data: [{ price: { id: PRO_PRICE } }, { price: { id: SCALE_PRICE } }] } })];
    await apply("customer.subscription.updated", sub());
    expect((await get()).plan).toBe("scale");
  });

  it("never trusts a plan name in metadata, only price ids", async () => {
    stripeState = [sub({ metadata: { project_id: project.id, plan: "scale" }, items: price("price_unknown") })];
    await apply("customer.subscription.created", sub({ metadata: { project_id: project.id, plan: "scale" } }));
    expect((await get()).plan).toBe("free");
  });

  it("does not downgrade a payer whose live subscription has an unknown price", async () => {
    await linked();
    stripeState = [sub({ items: price("price_unknown") })];
    const r = await apply("customer.subscription.updated", sub());
    expect(r).toMatchObject({ changed: false, reason: "unknown price" });
    expect((await get()).plan).toBe("pro");
  });
});

describe("out-of-order and replayed events", () => {
  it("a late subscription.updated(active) after deleted does not re-grant the plan", async () => {
    await linked();
    stripeState = [sub({ status: "canceled" })];
    await apply("customer.subscription.deleted", sub({ status: "canceled" }));
    await apply("customer.subscription.updated", sub({ status: "active" }));
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it("a late subscription.created(incomplete) after updated(active) does not downgrade a payer", async () => {
    stripeState = [sub({ status: "active" })];
    await apply("customer.subscription.updated", sub({ status: "active" }));
    await apply("customer.subscription.created", sub({ status: "incomplete" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_1" });
  });

  it("a late checkout.session.completed does not re-link a dead subscription", async () => {
    stripeState = [sub({ status: "canceled" })];
    await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: null });
  });

  it("any ordering of the same events ends in the same state", async () => {
    stripeState = [sub({ id: "sub_2", items: price(SCALE_PRICE) }), sub({ id: "sub_1", status: "canceled" })];
    const events = [
      ["customer.subscription.created", sub({ id: "sub_1", status: "incomplete" })],
      ["customer.subscription.updated", sub({ id: "sub_1", status: "active" })],
      ["customer.subscription.deleted", sub({ id: "sub_1", status: "canceled" })],
      ["customer.subscription.created", sub({ id: "sub_2", status: "active", items: price(SCALE_PRICE) })],
      ["checkout.session.completed", checkoutSession({ client_reference_id: project.id, subscription: "sub_1" })],
    ] as const;
    const orders = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 1, 0, 4, 3], [3, 0, 4, 1, 2]];
    for (const order of orders) {
      await store.setBilling(project.id, { plan: "free", stripe_customer_id: null, stripe_subscription_id: null });
      for (const i of order) await apply(events[i][0], events[i][1]);
      expect(await get()).toMatchObject({ plan: "scale", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_2" });
    }
  });

  it("applying the same event twice writes once", async () => {
    stripeState = [sub()];
    const spy = vi.spyOn(store, "setBilling");
    const first = await apply("customer.subscription.created", sub());
    const second = await apply("customer.subscription.created", sub());
    expect(first.changed).toBe(true);
    expect(second).toMatchObject({ changed: false, reason: "already up to date" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("two live subscriptions", () => {
  it("deleting one keeps the plan of the other and points at it", async () => {
    await store.setBilling(project.id, { plan: "scale", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_2" });
    stripeState = [sub({ id: "sub_2", items: price(SCALE_PRICE) }), sub({ id: "sub_1", status: "canceled" })];
    await apply("customer.subscription.deleted", sub({ id: "sub_1", status: "canceled" }));
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_2" });
  });

  it("deleting the higher one falls back to the remaining lower one", async () => {
    await store.setBilling(project.id, { plan: "scale", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_2" });
    stripeState = [sub({ id: "sub_2", status: "canceled", items: price(SCALE_PRICE) }), sub({ id: "sub_1" })];
    await apply("customer.subscription.deleted", sub({ id: "sub_2", status: "canceled" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_1" });
  });

  it("chooses the highest plan while both are live", async () => {
    stripeState = [sub({ id: "sub_1" }), sub({ id: "sub_2", items: price(SCALE_PRICE) })];
    await apply("customer.subscription.created", sub({ id: "sub_2" }));
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_2" });
  });
});

describe("project resolution", () => {
  it("finds the project by customer id when metadata is missing", async () => {
    await store.setBilling(project.id, { stripe_customer_id: "cus_1" });
    stripeState = [sub()];
    await apply("customer.subscription.created", subscription());
    expect((await get()).plan).toBe("pro");
  });

  it("prefers an already linked customer over the project id in the payload", async () => {
    const other = await store.createProject("owner", "Other");
    await store.setBilling(other.id, { stripe_customer_id: "cus_1" });
    stripeState = [sub()];
    await apply("customer.subscription.created", sub());
    expect((await store.getProject(other.id))?.plan).toBe("pro");
    expect((await get()).plan).toBe("free");
  });

  it("refuses a project that is linked to a different customer", async () => {
    await store.setBilling(project.id, { plan: "free", stripe_customer_id: "cus_mine" });
    stripeState = [sub({ customer: "cus_attacker" })];
    const r = await apply("customer.subscription.created", sub({ customer: "cus_attacker" }));
    expect(r).toMatchObject({ handled: true, changed: false, reason: "customer mismatch" });
    expect(list).not.toHaveBeenCalled();
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_mine" });
  });

  it("links the customer to a project that has none yet", async () => {
    stripeState = [sub()];
    await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    expect((await get()).stripe_customer_id).toBe("cus_1");
  });

  it("ignores events for projects it cannot find", async () => {
    const r = await apply("customer.subscription.created", subscription({ customer: "cus_nobody" }));
    expect(r).toMatchObject({ handled: true, changed: false, reason: "no matching project" });
    expect(list).not.toHaveBeenCalled();
  });

  it("reads an expanded customer object", async () => {
    stripeState = [sub({ customer: { id: "cus_7", object: "customer" } })];
    await apply("customer.subscription.created", sub({ customer: { id: "cus_7", object: "customer" } }));
    expect((await get()).stripe_customer_id).toBe("cus_7");
  });
});

describe("unknown events and failures", () => {
  it.each(["invoice.paid", "customer.created", "charge.refunded", "payment_intent.succeeded"])("ignores %s", async (type) => {
    const spy = vi.spyOn(store, "setBilling");
    const r = await apply(type, { id: "x", customer: "cus_1", metadata: { project_id: project.id } });
    expect(r).toMatchObject({ handled: false, changed: false });
    expect(spy).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("propagates Stripe API failures so the route answers 500 and Stripe retries", async () => {
    list.mockRejectedValueOnce(new Error("stripe down"));
    await expect(apply("customer.subscription.created", sub())).rejects.toThrow("stripe down");
    expect((await get()).plan).toBe("free");
  });

  it("propagates store failures", async () => {
    stripeState = [sub()];
    vi.spyOn(store, "setBilling").mockRejectedValueOnce(new Error("db down"));
    await expect(apply("customer.subscription.created", sub())).rejects.toThrow("db down");
  });
});
