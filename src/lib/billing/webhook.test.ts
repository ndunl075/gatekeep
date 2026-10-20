import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { MemoryStore } from "../store/memory";
import type { Project } from "../types";
import { applyStripeEvent, type StripeSubscriptions } from "./webhook";
import { PRO_PRICE, SCALE_PRICE, checkoutSession, makeFakeStripe, stripeEvent, subscription } from "./test-helpers";

let store: MemoryStore;
let project: Project;
/** What Stripe would answer right now. Events never carry the truth, this does. */
let fake: ReturnType<typeof makeFakeStripe>;
let stripe: StripeSubscriptions;
let list: ReturnType<typeof makeFakeStripe>["api"]["subscriptions"]["list"];
const setSubs = (subs: unknown[]) => {
  fake.state.subs = subs as typeof fake.state.subs;
};

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
  fake = makeFakeStripe(10);
  list = fake.api.subscriptions.list;
  stripe = fake.client as unknown as StripeSubscriptions;
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
    setSubs([sub()]);
    const r = await apply(type, payload());
    expect(r.changed).toBe(true);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1", status: "all" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  });

  it("the payload never decides the plan: a deleted event with an active price payload still follows Stripe", async () => {
    await linked();
    setSubs([sub({ status: "canceled" })]);
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
    setSubs([sub({ status, items: price(priceId) })]);
    await apply("customer.subscription.updated", sub());
    expect(await get()).toMatchObject({ plan, stripe_subscription_id: "sub_1" });
  });

  it.each(["unpaid", "incomplete", "paused", "canceled", "incomplete_expired"])("%s is free with no subscription id", async (status) => {
    await linked();
    setSubs([sub({ status })]);
    await apply("customer.subscription.updated", sub());
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it("follows a plan change on the same subscription", async () => {
    setSubs([sub()]);
    await apply("customer.subscription.created", sub());
    setSubs([sub({ items: price(SCALE_PRICE) })]);
    await apply("customer.subscription.updated", sub());
    expect((await get()).plan).toBe("scale");
  });

  it("takes the highest plan when several items are present", async () => {
    setSubs([sub({ items: { data: [{ price: { id: PRO_PRICE } }, { price: { id: SCALE_PRICE } }] } })]);
    await apply("customer.subscription.updated", sub());
    expect((await get()).plan).toBe("scale");
  });

  it("never trusts a plan name in metadata, only price ids", async () => {
    setSubs([sub({ metadata: { project_id: project.id, plan: "scale" }, items: price("price_unknown") })]);
    await apply("customer.subscription.created", sub({ metadata: { project_id: project.id, plan: "scale" } }));
    expect((await get()).plan).toBe("free");
  });

  it("does not downgrade a payer whose live subscription has an unknown price", async () => {
    await linked();
    setSubs([sub({ items: price("price_unknown") })]);
    const r = await apply("customer.subscription.updated", sub());
    expect(r).toMatchObject({ changed: false, reason: "unknown price" });
    expect((await get()).plan).toBe("pro");
  });
});

describe("out-of-order and replayed events", () => {
  it("a late subscription.updated(active) after deleted does not re-grant the plan", async () => {
    await linked();
    setSubs([sub({ status: "canceled" })]);
    await apply("customer.subscription.deleted", sub({ status: "canceled" }));
    await apply("customer.subscription.updated", sub({ status: "active" }));
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it("a late subscription.created(incomplete) after updated(active) does not downgrade a payer", async () => {
    setSubs([sub({ status: "active" })]);
    await apply("customer.subscription.updated", sub({ status: "active" }));
    await apply("customer.subscription.created", sub({ status: "incomplete" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_1" });
  });

  it("a late checkout.session.completed does not re-link a dead subscription", async () => {
    setSubs([sub({ status: "canceled" })]);
    await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_1", stripe_subscription_id: null });
  });

  it("any ordering of the same events ends in the same state", async () => {
    setSubs([sub({ id: "sub_2", items: price(SCALE_PRICE) }), sub({ id: "sub_1", status: "canceled" })]);
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
    setSubs([sub()]);
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
    setSubs([sub({ id: "sub_2", items: price(SCALE_PRICE) }), sub({ id: "sub_1", status: "canceled" })]);
    await apply("customer.subscription.deleted", sub({ id: "sub_1", status: "canceled" }));
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_2" });
  });

  it("deleting the higher one falls back to the remaining lower one", async () => {
    await store.setBilling(project.id, { plan: "scale", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_2" });
    setSubs([sub({ id: "sub_2", status: "canceled", items: price(SCALE_PRICE) }), sub({ id: "sub_1" })]);
    await apply("customer.subscription.deleted", sub({ id: "sub_2", status: "canceled" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_1" });
  });

  it("chooses the highest plan while both are live", async () => {
    setSubs([sub({ id: "sub_1" }), sub({ id: "sub_2", items: price(SCALE_PRICE) })]);
    await apply("customer.subscription.created", sub({ id: "sub_2" }));
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_2" });
  });
});

describe("project resolution", () => {
  it("finds the project by customer id when metadata is missing", async () => {
    await store.setBilling(project.id, { stripe_customer_id: "cus_1" });
    setSubs([sub()]);
    await apply("customer.subscription.created", subscription());
    expect((await get()).plan).toBe("pro");
  });

  it("prefers an already linked customer over the project id in the payload", async () => {
    const other = await store.createProject("owner", "Other");
    await store.setBilling(other.id, { stripe_customer_id: "cus_1" });
    setSubs([sub()]);
    await apply("customer.subscription.created", sub());
    expect((await store.getProject(other.id))?.plan).toBe("pro");
    expect((await get()).plan).toBe("free");
  });

  it("refuses a project that is linked to a different customer", async () => {
    await store.setBilling(project.id, { plan: "free", stripe_customer_id: "cus_mine" });
    setSubs([sub({ customer: "cus_attacker" })]);
    const r = await apply("customer.subscription.created", sub({ customer: "cus_attacker" }));
    expect(r).toMatchObject({ handled: true, changed: false, reason: "customer mismatch" });
    expect(list).not.toHaveBeenCalled();
    expect(await get()).toMatchObject({ plan: "free", stripe_customer_id: "cus_mine" });
  });

  it("links the customer to a project that has none yet", async () => {
    setSubs([sub()]);
    await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    expect((await get()).stripe_customer_id).toBe("cus_1");
  });

  it("ignores events for projects it cannot find", async () => {
    const r = await apply("customer.subscription.created", subscription({ customer: "cus_nobody" }));
    expect(r).toMatchObject({ handled: true, changed: false, reason: "no matching project" });
    expect(list).not.toHaveBeenCalled();
  });

  it("reads an expanded customer object", async () => {
    setSubs([sub({ customer: { id: "cus_7", object: "customer" } })]);
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
    setSubs([sub()]);
    vi.spyOn(store, "setBilling").mockRejectedValueOnce(new Error("db down"));
    await expect(apply("customer.subscription.created", sub())).rejects.toThrow("db down");
  });
});

describe("pagination", () => {
  const dead = (n: number) =>
    Array.from({ length: n }, (_, i) => sub({ id: `sub_dead_${i}`, status: i % 2 ? "canceled" : "incomplete_expired" }));

  it("finds an old live subscription behind 25 newer dead ones (3 pages)", async () => {
    setSubs([...dead(25), sub({ id: "sub_old", items: price(SCALE_PRICE) })]);
    await apply("customer.subscription.updated", sub());
    expect(list.mock.calls.length).toBe(3);
    expect(list.mock.calls[1][0]).toMatchObject({ starting_after: "sub_dead_9" });
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_old" });
  });

  it("does not free a payer when a full page of dead subscriptions comes first", async () => {
    await store.setBilling(project.id, { plan: "pro", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_old" });
    setSubs([...dead(10), sub({ id: "sub_old" })]);
    await apply("customer.subscription.created", sub({ id: "sub_dead_0", status: "incomplete" }));
    expect(await get()).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_old" });
  });

  it("still goes to free when all pages are dead", async () => {
    await linked();
    setSubs(dead(23));
    await apply("customer.subscription.deleted", sub());
    expect(await get()).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  it("stops with an error instead of looping forever", async () => {
    list.mockImplementation(async () => ({ data: [sub({ id: "sub_x" })], has_more: true }) as never);
    await expect(apply("customer.subscription.created", sub())).rejects.toThrow(/more than/);
  });
});

describe("duplicate live subscriptions", () => {
  const cancel = () => fake.api.subscriptions.cancel;

  it("keeps the best subscription and cancels the extra one with proration", async () => {
    setSubs([sub({ id: "sub_a" }), sub({ id: "sub_b", items: price(SCALE_PRICE) })]);
    const r = await apply("customer.subscription.created", sub({ id: "sub_b" }));
    expect(r.canceled).toEqual(["sub_a"]);
    expect(cancel()).toHaveBeenCalledTimes(1);
    expect(cancel()).toHaveBeenCalledWith("sub_a", { prorate: true });
    expect(await get()).toMatchObject({ plan: "scale", stripe_subscription_id: "sub_b" });
  });

  it("two subscriptions of the same plan: the newest (first in Stripe's list) is kept", async () => {
    setSubs([sub({ id: "sub_new" }), sub({ id: "sub_old" })]);
    await apply("checkout.session.completed", checkoutSession({ client_reference_id: project.id }));
    expect(cancel()).toHaveBeenCalledWith("sub_old", { prorate: true });
    expect((await get()).stripe_subscription_id).toBe("sub_new");
  });

  it("cancels every extra, including trialing and past_due ones", async () => {
    setSubs([
      sub({ id: "sub_a", items: price(SCALE_PRICE) }),
      sub({ id: "sub_b", status: "trialing" }),
      sub({ id: "sub_c", status: "past_due" }),
      sub({ id: "sub_d", status: "canceled" }),
    ]);
    const r = await apply("customer.subscription.updated", sub());
    expect(r.canceled).toEqual(["sub_b", "sub_c"]);
  });

  it("is idempotent: the second delivery finds nothing left to cancel", async () => {
    setSubs([sub({ id: "sub_a" }), sub({ id: "sub_b", items: price(SCALE_PRICE) })]);
    await apply("customer.subscription.created", sub());
    const second = await apply("customer.subscription.created", sub());
    expect(second.canceled).toBeUndefined();
    expect(cancel()).toHaveBeenCalledTimes(1);
  });

  it("never cancels a live subscription with a price it does not know", async () => {
    setSubs([sub({ id: "sub_a" }), sub({ id: "sub_other", items: price("price_unknown") })]);
    await apply("customer.subscription.created", sub());
    expect(cancel()).not.toHaveBeenCalled();
    expect((await get()).plan).toBe("pro");
  });

  it("cancels nothing when there is no live subscription", async () => {
    setSubs([sub({ status: "canceled" })]);
    await apply("customer.subscription.deleted", sub());
    expect(cancel()).not.toHaveBeenCalled();
  });

  it("ignores an extra that is already gone, but fails the event on any other cancel error", async () => {
    setSubs([sub({ id: "sub_a" }), sub({ id: "sub_b", items: price(SCALE_PRICE) })]);
    cancel().mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "resource_missing" }));
    await expect(apply("customer.subscription.created", sub())).resolves.toMatchObject({ handled: true });

    setSubs([sub({ id: "sub_a" }), sub({ id: "sub_b", items: price(SCALE_PRICE) })]);
    cancel().mockRejectedValueOnce(new Error("stripe down"));
    await expect(apply("customer.subscription.created", sub())).rejects.toThrow("stripe down");
    // the plan was already written, so a retry only has the cancel left to do
    expect((await get()).plan).toBe("scale");
  });
});
