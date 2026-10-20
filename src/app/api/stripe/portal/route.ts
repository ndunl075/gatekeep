import { NextResponse } from "next/server";
import { BillingError, createPortalSession } from "@/lib/billing/stripe";
import { DEMO_BILLING_MESSAGE, isSameOrigin, messagePage } from "@/lib/billing/request";
import { getCurrentProject } from "@/lib/session";
import { hasStripe, isDemoMode } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Form POST from the billing page. Redirects (303) to the Stripe customer portal (change plan, card, cancel). */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return messagePage("Request blocked", "This request did not come from gatekeep.", 403);
  // Demo mode has one shared project and no login: anyone could open its Stripe portal or cancel its plan.
  if (isDemoMode()) return messagePage("Billing is unavailable", DEMO_BILLING_MESSAGE, 503);
  if (!hasStripe()) return messagePage("Billing is not configured", "Set STRIPE_SECRET_KEY to turn on paid plans.", 503);

  let project;
  try {
    project = await getCurrentProject();
  } catch {
    return messagePage("Sign in required", "Sign in to manage billing.", 401);
  }

  try {
    return NextResponse.redirect(await createPortalSession(project), 303);
  } catch (err) {
    if (err instanceof BillingError) return messagePage("Nothing to manage yet", err.message, 409);
    console.error("stripe portal failed", err);
    return NextResponse.redirect(new URL("/dashboard/billing?status=error", req.url), 303);
  }
}
