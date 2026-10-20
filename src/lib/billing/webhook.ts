// Applies Stripe webhook events to the store. Pure with respect to Stripe: it only reads the event payload,
// never calls the Stripe API, so it is fully testable offline. Safe to run twice for the same event.
import type Stripe from "stripe";
import { PLAN_ORDER } from "../plans";
import type { Store } from "../store/types";
import type { PlanId, Project } from "../types";
import { planForPriceId } from "./stripe";

export interface ApplyResult {
  /** True when the event type is one we act on (even if it changed nothing). */
  handled: boolean;
  /** True when the store was written. False for no-ops, replays and ignored events. */
  changed: boolean;
  projectId?: string;
  plan?: PlanId;
  /** Why nothing was written (or a note on what happened). */
  reason?: string;
}

/** Subscription states that keep the paid plan. past_due keeps it while Stripe retries the card. */
const PAID_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);
/** Terminal states: the subscription can never come back, so its id is cleared. */
const DEAD_STATUSES = new Set<Stripe.Subscription.Status>(["canceled", "incomplete_expired"]);

type Ref = string | { id: string } | null | undefined;

function idOf(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function findProject(
  store: Store,
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null,
  clientReferenceId?: string | null,
): Promise<Project | null> {
  // The project id in metadata was set by us when we created the session / subscription.
  const candidates = [metadata?.project_id, clientReferenceId].filter((v): v is string => Boolean(v));
  for (const id of candidates) {
    const p = await store.getProject(id);
    if (p) return p;
  }
  return customerId ? store.getProjectByStripeCustomer(customerId) : null;
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

async function write(
  store: Store,
  project: Project,
  patch: { plan: PlanId; stripe_customer_id: string | null; stripe_subscription_id: string | null },
): Promise<ApplyResult> {
  const same =
    project.plan === patch.plan &&
    project.stripe_customer_id === patch.stripe_customer_id &&
    project.stripe_subscription_id === patch.stripe_subscription_id;
  if (same) return { handled: true, changed: false, projectId: project.id, plan: patch.plan, reason: "already up to date" };
  await store.setBilling(project.id, patch);
  return { handled: true, changed: true, projectId: project.id, plan: patch.plan };
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session, store: Store): Promise<ApplyResult> {
  if (session.mode !== "subscription") return { handled: false, changed: false, reason: "not a subscription checkout" };
  const customerId = idOf(session.customer);
  const project = await findProject(store, session.metadata, customerId, session.client_reference_id);
  if (!project) return { handled: true, changed: false, reason: "no matching project" };
  // The plan comes from the subscription events (they carry the price). Here we only link the Stripe ids.
  // A fully discounted checkout (promo code) reports no_payment_required, which is fine.
  if (session.payment_status === "unpaid") {
    return { handled: true, changed: false, projectId: project.id, reason: "payment not completed" };
  }
  return write(store, project, {
    plan: project.plan,
    stripe_customer_id: customerId ?? project.stripe_customer_id,
    stripe_subscription_id: project.stripe_subscription_id ?? idOf(session.subscription),
  });
}

async function onSubscriptionChanged(sub: Stripe.Subscription, store: Store): Promise<ApplyResult> {
  const customerId = idOf(sub.customer);
  const project = await findProject(store, sub.metadata, customerId);
  if (!project) return { handled: true, changed: false, reason: "no matching project" };

  const isCurrent = !project.stripe_subscription_id || project.stripe_subscription_id === sub.id;
  const paid = PAID_STATUSES.has(sub.status);

  if (!isCurrent && !paid) {
    // A dead or unpaid old subscription must not downgrade the one the project is on now.
    return { handled: true, changed: false, projectId: project.id, reason: "stale subscription" };
  }

  const customer = customerId ?? project.stripe_customer_id;
  if (!paid) {
    return write(store, project, {
      plan: "free",
      stripe_customer_id: customer,
      stripe_subscription_id: DEAD_STATUSES.has(sub.status) ? null : sub.id,
    });
  }

  const plan = planFromSubscription(sub);
  if (!plan) {
    // Never guess a plan: an unknown price leaves the project as it was.
    return { handled: true, changed: false, projectId: project.id, reason: "unknown price" };
  }
  return write(store, project, { plan, stripe_customer_id: customer, stripe_subscription_id: sub.id });
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, store: Store): Promise<ApplyResult> {
  const customerId = idOf(sub.customer);
  const project = await findProject(store, sub.metadata, customerId);
  if (!project) return { handled: true, changed: false, reason: "no matching project" };
  if (project.stripe_subscription_id && project.stripe_subscription_id !== sub.id) {
    return { handled: true, changed: false, projectId: project.id, reason: "stale subscription" };
  }
  return write(store, project, {
    plan: "free",
    stripe_customer_id: customerId ?? project.stripe_customer_id,
    stripe_subscription_id: null,
  });
}

/**
 * Applies one verified Stripe event. Throws only on store failures (the route then answers 500 so Stripe retries);
 * unknown events and events for unknown projects resolve normally.
 */
export async function applyStripeEvent(event: Stripe.Event, store: Store): Promise<ApplyResult> {
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(event.data.object, store);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return onSubscriptionChanged(event.data.object, store);
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(event.data.object, store);
    default:
      return { handled: false, changed: false, reason: "ignored event type" };
  }
}
