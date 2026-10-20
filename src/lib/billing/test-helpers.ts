import { vi } from "vitest";
// Builders for Stripe webhook payloads in tests. Only the fields the handlers read are filled in.
import type Stripe from "stripe";

export const PRO_PRICE = "price_pro_test";
export const SCALE_PRICE = "price_scale_test";

export function subscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    object: "subscription",
    status: "active",
    customer: "cus_1",
    metadata: { project_id: "" },
    items: { object: "list", data: [{ id: "si_1", price: { id: PRO_PRICE } }] },
    ...over,
  };
}

export function checkoutSession(over: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    object: "checkout.session",
    mode: "subscription",
    payment_status: "paid",
    customer: "cus_1",
    subscription: "sub_1",
    client_reference_id: null,
    metadata: {},
    ...over,
  };
}

let n = 0;
export function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_${++n}`,
    object: "event",
    type,
    api_version: "test",
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

type AnySub = Record<string, unknown> & { id: string; status: string };
type AnySession = { id: string; url: string; customer: string; status: string; price?: string };

/**
 * A stateful stand-in for the parts of the Stripe API billing uses. Lists are paginated like the real API
 * (`pageSize` caps `limit`, `has_more` / `starting_after` work), so ">1 page" bugs show up.
 */
export function makeFakeStripe(pageSize = 100) {
  const state = {
    subs: [] as AnySub[],
    sessions: [] as AnySession[],
    customers: [] as { id: string }[],
    missingCustomers: new Set<string>(),
    idempotent: new Map<string, { id: string }>(),
    nextId: 1,
  };
  const missing = (what: string) => Object.assign(new Error(`No such ${what}`), { code: "resource_missing", type: "StripeInvalidRequestError" });
  const page = <T extends { id: string }>(rows: T[], params: { limit?: number; starting_after?: string }) => {
    const size = Math.min(params.limit ?? 10, pageSize);
    const from = params.starting_after ? rows.findIndex((r) => r.id === params.starting_after) + 1 : 0;
    const data = rows.slice(from, from + size);
    return { data, has_more: from + size < rows.length };
  };
  const checkCustomer = (id: string) => {
    if (state.missingCustomers.has(id)) throw missing("customer");
  };

  const api = {
    subscriptions: {
      list: vi.fn(async (p: { customer: string; status?: string; limit?: number; starting_after?: string }) => {
        checkCustomer(p.customer);
        const rows = state.subs.filter((s) => (s.customer as string) === p.customer && (p.status === "all" || !p.status || s.status === p.status));
        return page(rows, p);
      }),
      cancel: vi.fn(async (id: string) => {
        const sub = state.subs.find((s) => s.id === id);
        if (!sub) throw missing("subscription");
        sub.status = "canceled";
        return sub;
      }),
    },
    checkout: {
      sessions: {
        list: vi.fn(async (p: { customer: string; status?: string; limit?: number; starting_after?: string }) => {
          checkCustomer(p.customer);
          return page(state.sessions.filter((s) => s.customer === p.customer && s.status === (p.status ?? "open")), p);
        }),
        expire: vi.fn(async (id: string) => {
          const s = state.sessions.find((x) => x.id === id);
          if (!s) throw missing("session");
          s.status = "expired";
          return s;
        }),
        create: vi.fn(async (p: { customer: string; line_items: { price: string }[] }) => {
          checkCustomer(p.customer);
          const id = `cs_${state.nextId++}`;
          const s: AnySession = { id, url: `https://checkout.stripe.test/${id}`, customer: p.customer, status: "open", price: p.line_items[0]?.price };
          state.sessions.push(s);
          return s;
        }),
      },
    },
    customers: {
      // Like Stripe, a replayed idempotency key returns the original customer instead of making another.
      create: vi.fn(async (_params?: unknown, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey;
        if (key && state.idempotent.has(key)) return state.idempotent.get(key)!;
        const c = { id: `cus_new${state.nextId++}` };
        state.customers.push(c);
        if (key) state.idempotent.set(key, c);
        return c;
      }),
    },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://portal.stripe.test/p" })) } },
  };
  return { state, api, client: api as unknown as Stripe };
}
