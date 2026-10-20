import { AppContent } from "@/components/ui/app-window";
import { PageTitle } from "@/components/ui";
import { Notice } from "@/components/billing/notices";
import { PlansPanel } from "@/components/billing/plans-panel";
import { UsagePanel } from "@/components/billing/usage-panel";
import { billingAvailability } from "@/lib/billing/stripe";
import { usageSummary } from "@/lib/billing/usage";
import { getCurrentProject } from "@/lib/session";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const project = await getCurrentProject();
  const used = await getStore().monthlyUsage(project.id);
  const usage = usageSummary(project.plan, used);
  const { configured, prices } = billingAvailability();

  return (
    <AppContent>
      <PageTitle sub="Your plan, this month's checks, and how to change them.">Billing</PageTitle>

      {status === "success" && (
        <Notice tone="ok" title="Payment received">
          Your plan updates as soon as Stripe confirms it, usually within a few seconds. Refresh if it still shows the
          old plan.
        </Notice>
      )}
      {status === "error" && (
        <Notice tone="warn" title="That did not go through">
          Nothing was charged. Try again, and if it keeps happening contact support.
        </Notice>
      )}
      {!configured && (
        <Notice tone="info" title="Billing is not configured">
          Paid plans are off because STRIPE_SECRET_KEY is not set. Checks work normally on the {project.plan} plan.
          See docs/stripe.md to turn billing on.
        </Notice>
      )}
      {configured && (!prices.pro || !prices.scale) && (
        <Notice tone="warn" title="Some plans are not set up">
          Set {[!prices.pro && "STRIPE_PRICE_PRO", !prices.scale && "STRIPE_PRICE_SCALE"].filter(Boolean).join(" and ")}{" "}
          to enable upgrades. Run scripts/stripe-setup.mjs to create the prices.
        </Notice>
      )}

      <div className="space-y-4">
        <UsagePanel plan={project.plan} usage={usage} />
        <PlansPanel
          current={project.plan}
          hasSubscription={Boolean(project.stripe_subscription_id)}
          hasCustomer={Boolean(project.stripe_customer_id)}
          configured={configured}
          prices={prices}
        />
      </div>
    </AppContent>
  );
}
