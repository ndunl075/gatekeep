import { NextResponse } from "next/server";
import { BillingError, createCheckoutSession, createPortalSession, isPaidPlan } from "@/lib/billing/stripe";
import { DEMO_BILLING_MESSAGE, isSameOrigin, messagePage } from "@/lib/billing/request";
import { getCurrentProject, getCurrentUser } from "@/lib/session";
import { hasStripe, isDemoMode } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req: Request, query = "") => NextResponse.redirect(new URL(`/dashboard/billing${query}`, req.url), 303);

/** Form POST from the billing page: field `plan` = pro | scale. Redirects (303) to Stripe Checkout. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return messagePage("Request blocked", "This request did not come from gatekeep.", 403);
  // Demo mode has one shared project and no login: anyone could open its Stripe portal or cancel its plan.
  if (isDemoMode()) return messagePage("Billing is unavailable", DEMO_BILLING_MESSAGE, 503);
  if (!hasStripe()) return messagePage("Billing is not configured", "Set STRIPE_SECRET_KEY to turn on paid plans.", 503);

  let project;
  let email: string | undefined;
  try {
    project = await getCurrentProject();
    email = (await getCurrentUser())?.email;
  } catch {
    return messagePage("Sign in required", "Sign in to change your plan.", 401);
  }

  const form = await req.formData().catch(() => null);
  const plan = form?.get("plan");
  if (!isPaidPlan(plan)) return back(req, "?status=error");

  try {
    return NextResponse.redirect(await createCheckoutSession(project, plan, { email }), 303);
  } catch (err) {
    if (err instanceof BillingError && err.code === "already_subscribed") {
      // Plan changes for an existing subscription happen in the customer portal, never as a second subscription.
      try {
        return NextResponse.redirect(await createPortalSession(project), 303);
      } catch (portalErr) {
        console.error("stripe portal redirect failed", portalErr);
        return back(req, "?status=error");
      }
    }
    if (err instanceof BillingError && err.code === "not_configured") {
      return messagePage("Billing is not configured", err.message, 503);
    }
    console.error("stripe checkout failed", err);
    return back(req, "?status=error");
  }
}
