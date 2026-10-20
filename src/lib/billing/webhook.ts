// Applies Stripe webhook events to the store.
//
// Stripe does not deliver events in order and retries them for days, so an event payload never decides the plan.
// An event only says "something changed for this customer": we then read the customer's CURRENT subscriptions from
// Stripe and recompute the project's billing from them. Replays, reordering and duplicates all converge on the same
// result because the answer depends on Stripe's state now, not on which event arrived last.
import type Stripe from "stripe";
import { PLAN_ORDER } from "../plans";
import type { Store } from "../store/types";
import type { PlanId, Project } from "../types";
import { planForPriceId } from "./stripe";
import { LIVE_STATUSES } from "./statuses";
import { listAllSubscriptions, type StripeSubscriptions } from "./subscriptions";

export type { StripeSubscriptions };

export interface ApplyResult {
  /** True when the event type is one we act on (even if it changed nothing). */
  handled: boolean;
  /** True when the store was written. False for no-ops, replays and ignored events. */
  changed: boolean;
  projectId?: string;
  plan?: PlanId;
  /** Why nothing was written (or a note on what happened). */
  reason?: string;
  /** Extra live subscriptions cancelled because the customer was paying twice. */
  canceled?: string[];
}

type Ref = string | { id: string } | null | undefined;

function idOf(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/** Highest plan granted by any item on the subscription, or null when no price is one of ours. */
function planFromSubscription(sub: Stripe.Subscription): PlanId | null {
  let best: PlanId | null = null;
  for (const item of sub.items?.data ?? []) {
    const plan = planForPriceId(item.price?.id);
    if (plan && (!best || PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(best))) best = plan;
  }
  return best;
}

/** Healthier statuses win a tie: the subscription that is actually paying must outlive a flaky or trial one. */
const STATUS_RANK: Partial<Record<Stripe.Subscription.Status, number>> = { active: 3, trialing: 2, past_due: 1 };

/**
 * The subscription that should grant the plan: live, with a price we know. Ranked by plan, then status
 * (active > trialing > past_due), then newest (Stripe lists newest first, and only a strictly better one replaces).
 */
export function pickBestSubscription(subs: Stripe.Subscription[]): { sub: Stripe.Subscription; plan: PlanId } | null {
  let best: { sub: Stripe.Subscription; plan: PlanId } | null = null;
  for (const sub of subs) {
    if (!LIVE_STATUSES.has(sub.status)) continue;
    const plan = planFromSubscription(sub);
    if (!plan) continue;
    if (!best) {
      best = { sub, plan };
      continue;
    }
    const byPlan = PLAN_ORDER.indexOf(plan) - PLAN_ORDER.indexOf(best.plan);
    const byStatus = (STATUS_RANK[sub.status] ?? 0) - (STATUS_RANK[best.sub.status] ?? 0);
    if (byPlan > 0 || (byPlan === 0 && byStatus > 0)) best = { sub, plan };
  }
  return best;
}

interface Target {
  customerId: string | null;
  /** Project ids we stamped on the Stripe objects ourselves. */
  hints: string[];
}

function targetOf(event: Stripe.Event): Target | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription") return null;
      return {
        customerId: idOf(s.customer),
        hints: [s.metadata?.project_id, s.client_reference_id].filter((v): v is string => Boolean(v)),
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const s = event.data.object;
      return { customerId: idOf(s.customer), hints: [s.metadata?.project_id].filter((v): v is string => Boolean(v)) };
    }
    default:
      return null;
  }
}

async function resolveProject(
  store: Store,
  { customerId, hints }: Target,
): Promise<{ project: Project } | { reason: string }> {
  // A customer that is already linked to a project always wins over what the payload claims.
  if (customerId) {
    const linked = await store.getProjectByStripeCustomer(customerId);
    if (linked) return { project: linked };
  }
  for (const id of hints) {
    const project = await store.getProject(id);
    if (!project) continue;
    // Never attach a second Stripe customer to a project that already has one.
    if (project.stripe_customer_id && project.stripe_customer_id !== customerId) {
      console.warn("stripe webhook: customer mismatch for project", project.id);
      return { reason: "customer mismatch" };
    }
    return { project };
  }
  return { reason: "no matching project" };
}

/** Recomputes the project's plan and subscription id from the customer's current Stripe subscriptions. */
export async function syncProjectBilling(
  project: Project,
  customerId: string,
  stripe: StripeSubscriptions,
  store: Store,
): Promise<ApplyResult> {
  const data = await listAllSubscriptions(stripe, customerId);
  const best = pickBestSubscription(data);

  if (!best && data.some((s) => LIVE_STATUSES.has(s.status))) {
    // Paying, but with a price id this deployment does not know (env var missing or stale). Never guess a plan
    // and never downgrade someone who is being charged.
    return { handled: true, changed: false, projectId: project.id, reason: "unknown price" };
  }

  const next = {
    plan: best?.plan ?? ("free" as PlanId),
    stripe_customer_id: customerId,
    stripe_subscription_id: best?.sub.id ?? null,
  };
  const same =
    project.plan === next.plan &&
    project.stripe_customer_id === next.stripe_customer_id &&
    project.stripe_subscription_id === next.stripe_subscription_id;
  if (!same) await store.setBilling(project.id, next);

  // Two live subscriptions means the customer is being charged twice (two Checkout tabs both completed).
  // Keep the best one and cancel the rest. Extras with a price we do not know are left alone.
  const canceled = await cancelExtras(stripe, data, best?.sub.id);
  return {
    handled: true,
    changed: !same,
    projectId: project.id,
    plan: next.plan,
    ...(canceled.length ? { canceled } : {}),
    ...(same && !canceled.length ? { reason: "already up to date" } : {}),
  };
}

async function cancelExtras(
  stripe: StripeSubscriptions,
  subs: Stripe.Subscription[],
  keepId: string | undefined,
): Promise<string[]> {
  if (!keepId) return [];
  const canceled: string[] = [];
  for (const sub of subs) {
    if (sub.id === keepId || !LIVE_STATUSES.has(sub.status) || !planFromSubscription(sub)) continue;
    try {
      // prorate: the unused part of the period is credited to the customer's balance (not refunded to the card).
      await stripe.subscriptions.cancel(sub.id, { prorate: true });
      console.warn("stripe webhook: cancelled duplicate subscription", sub.id, "kept", keepId);
      canceled.push(sub.id);
    } catch (err) {
      // Already gone (another webhook got there first) is fine; anything else must fail the event so Stripe retries.
      if ((err as { code?: string })?.code !== "resource_missing") throw err;
    }
  }
  return canceled;
}

/**
 * Handles one verified Stripe event. Throws on store or Stripe API failures (the route then answers 500 so Stripe
 * retries); unknown events and events for unknown projects resolve normally.
 */
export async function applyStripeEvent(
  event: Stripe.Event,
  store: Store,
  stripe: StripeSubscriptions,
): Promise<ApplyResult> {
  const target = targetOf(event);
  if (!target) return { handled: false, changed: false, reason: "ignored event" };
  if (!target.customerId) return { handled: true, changed: false, reason: "no customer on event" };

  const found = await resolveProject(store, target);
  if ("reason" in found) return { handled: true, changed: false, reason: found.reason };
  return syncProjectBilling(found.project, target.customerId, stripe, store);
}
