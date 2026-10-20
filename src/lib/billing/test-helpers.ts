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
