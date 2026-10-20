// Reading a customer's subscriptions from Stripe, completely.
import type Stripe from "stripe";

/** The slice of the Stripe client the billing code needs for subscriptions; tests pass a fake. */
export interface StripeSubscriptions {
  subscriptions: {
    list(
      params: Stripe.SubscriptionListParams,
    ): PromiseLike<{ data: Stripe.Subscription[]; has_more?: boolean }>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): PromiseLike<unknown>;
  };
}

/** Abandoned checkouts leave incomplete_expired rows behind, so a customer can have far more than one page. */
const PAGE_SIZE = 100;
/** Hard stop against a loop that never ends (a misbehaving fake or API): 5,000 subscriptions on one customer. */
const MAX_PAGES = 50;

/**
 * Every subscription the customer has, in any status, newest first. Pages until Stripe says there is no more:
 * a live subscription hiding behind a page of cancelled ones must never look like "no subscription".
 */
export async function listAllSubscriptions(
  stripe: Pick<StripeSubscriptions, "subscriptions">,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const all: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...res.data);
    if (!res.has_more || res.data.length === 0) return all;
    startingAfter = res.data[res.data.length - 1].id;
  }
  throw new Error(`customer ${customerId} has more than ${MAX_PAGES * PAGE_SIZE} subscriptions`);
}
