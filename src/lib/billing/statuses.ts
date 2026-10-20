import type Stripe from "stripe";

/** Subscription states that keep the paid plan. past_due keeps it while Stripe retries the card. */
export const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);
/** States that mean a subscription exists or may still start: a new checkout must not create another. */
export const BLOCKING_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paused",
]);
