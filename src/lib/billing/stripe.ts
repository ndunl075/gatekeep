// Stripe client, plan <-> price mapping, and the checkout / portal session helpers.
// No "server-only" import so vitest can load this file; it only ever runs on the server (it reads secrets).
import Stripe from "stripe";
import { env, hasStripe, isDemoMode } from "../env";
import { getStore } from "../store";
import { BLOCKING_STATUSES } from "./statuses";
import { listAllSubscriptions } from "./subscriptions";
import type { Store } from "../store/types";
import type { PlanId, Project } from "../types";

export type PaidPlan = Exclude<PlanId, "free">;

export const PAID_PLANS: PaidPlan[] = ["pro", "scale"];

export type BillingErrorCode = "not_configured" | "bad_plan" | "no_price" | "already_subscribed" | "no_customer";

/** A billing problem the caller can show to the user. Anything else thrown is an unexpected Stripe/store failure. */
export class BillingError extends Error {
  constructor(
    public code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

let cached: { key: string; client: Stripe } | null = null;

/** The Stripe client, or null when STRIPE_SECRET_KEY is unset (billing off). */
export function getStripe(): Stripe | null {
  if (!hasStripe()) return null;
  if (!cached || cached.key !== env.stripeSecret) {
    cached = { key: env.stripeSecret, client: new Stripe(env.stripeSecret, { maxNetworkRetries: 2 }) };
  }
  return cached.client;
}

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === "pro" || v === "scale";
}

// Prices are read at call time, so the mapping always reflects the current environment.
function priceEnv(): Record<PaidPlan, string> {
  return {
    pro: process.env.STRIPE_PRICE_PRO ?? env.stripePricePro,
    scale: process.env.STRIPE_PRICE_SCALE ?? env.stripePriceScale,
  };
}

/** Stripe price id configured for a plan, or null (free, or the env var is unset). */
export function priceIdForPlan(plan: PlanId): string | null {
  if (!isPaidPlan(plan)) return null;
  return priceEnv()[plan] || null;
}

/** Plan a Stripe price id grants. Unknown or empty ids map to null, never to a paid plan. */
export function planForPriceId(priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null;
  const prices = priceEnv();
  return PAID_PLANS.find((p) => prices[p] && prices[p] === priceId) ?? null;
}

/** What the billing page can offer right now. */
export function billingAvailability(): { configured: boolean; demo: boolean; prices: Record<PaidPlan, boolean> } {
  return {
    configured: hasStripe(),
    // Demo mode has one shared, login-less project: it must never be tied to a real Stripe customer.
    demo: isDemoMode(),
    prices: { pro: Boolean(priceIdForPlan("pro")), scale: Boolean(priceIdForPlan("scale")) },
  };
}

interface Deps {
  stripe?: Stripe | null;
  store?: Store;
  appUrl?: string;
}

function requireStripe(deps: Deps): Stripe {
  const stripe = deps.stripe === undefined ? getStripe() : deps.stripe;
  if (!stripe) throw new BillingError("not_configured", "Billing is not configured.");
  return stripe;
}

function isMissingResource(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "resource_missing";
}

/** Reuses the project's Stripe customer or creates one, and persists the id. */
async function ensureCustomer(
  stripe: Stripe,
  project: Project,
  store: Store,
  email?: string,
  retry = false,
): Promise<string> {
  if (project.stripe_customer_id) return project.stripe_customer_id;
  const customer = await stripe.customers.create(
    {
      name: project.name,
      ...(email ? { email } : {}),
      metadata: { project_id: project.id },
    },
    // A replayed key returns the same customer for 24h, so a replacement after a stale id needs a fresh key.
    { idempotencyKey: `gatekeep-customer-${project.id}${retry ? `-${Date.now()}` : ""}` },
  );
  await store.setBilling(project.id, { stripe_customer_id: customer.id });
  return customer.id;
}

/**
 * Asks Stripe, not our database, whether the customer already has (or is starting) a subscription, then expires any
 * Checkout tab still open so two tabs can never both be paid. Throws resource_missing if the customer is gone.
 */
async function prepareExistingCustomer(stripe: Stripe, customerId: string): Promise<void> {
  const subs = await listAllSubscriptions(stripe, customerId);
  if (subs.some((s) => BLOCKING_STATUSES.has(s.status))) {
    throw new BillingError("already_subscribed", "This project already has a subscription. Use Manage or cancel.");
  }
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const open of res.data) {
      try {
        await stripe.checkout.sessions.expire(open.id);
      } catch (err) {
        // Completed or expired a moment ago (a Stripe invalid request): nothing left to close.
        // Anything else (network, API outage) could leave a second payable tab, so it fails the checkout.
        if ((err as { type?: string })?.type !== "StripeInvalidRequestError") throw err;
        console.warn("stripe checkout: could not expire open session", open.id);
      }
    }
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
}

/** Starts a subscription Checkout for a paid plan and returns the Stripe-hosted URL. */
export async function createCheckoutSession(
  project: Project,
  plan: PlanId,
  deps: Deps & { email?: string } = {},
): Promise<string> {
  const stripe = requireStripe(deps);
  if (!isPaidPlan(plan)) throw new BillingError("bad_plan", "Pick Pro or Scale.");
  const price = priceIdForPlan(plan);
  if (!price) throw new BillingError("no_price", `No Stripe price is configured for the ${plan} plan.`);

  const store = deps.store ?? getStore();
  const appUrl = (deps.appUrl ?? env.appUrl).replace(/\/$/, "");
  const attrs = { project_id: project.id };

  const build = (customer: string): Stripe.Checkout.SessionCreateParams => ({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: project.id,
    metadata: attrs,
    subscription_data: { metadata: attrs },
    success_url: `${appUrl}/dashboard/billing?status=success`,
    cancel_url: `${appUrl}/dashboard/billing`,
  });

  // The stored customer may no longer exist in this Stripe account (e.g. test keys swapped for live ones).
  // Whichever Stripe call first notices, forget it and start over with a fresh customer, once.
  let customerId = project.stripe_customer_id;
  let replaced = false;
  const forgetCustomer = async () => {
    await store.setBilling(project.id, { stripe_customer_id: null });
    customerId = null;
    replaced = true;
  };

  if (customerId) {
    try {
      await prepareExistingCustomer(stripe, customerId);
    } catch (err) {
      if (!isMissingResource(err)) throw err;
      await forgetCustomer();
    }
  }
  if (!customerId) {
    customerId = await ensureCustomer(stripe, { ...project, stripe_customer_id: null }, store, deps.email, replaced);
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(build(customerId));
  } catch (err) {
    if (replaced || !project.stripe_customer_id || !isMissingResource(err)) throw err;
    await forgetCustomer();
    customerId = await ensureCustomer(stripe, { ...project, stripe_customer_id: null }, store, deps.email, true);
    session = await stripe.checkout.sessions.create(build(customerId));
  }
  if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
  return session.url;
}

/** Customer portal URL where the customer changes plan, updates the card or cancels. */
export async function createPortalSession(project: Project, deps: Deps = {}): Promise<string> {
  const stripe = requireStripe(deps);
  if (!project.stripe_customer_id) throw new BillingError("no_customer", "No billing account yet. Pick a plan first.");
  const appUrl = (deps.appUrl ?? env.appUrl).replace(/\/$/, "");
  const session = await stripe.billingPortal.sessions.create({
    customer: project.stripe_customer_id,
    return_url: `${appUrl}/dashboard/billing`,
  });
  return session.url;
}
