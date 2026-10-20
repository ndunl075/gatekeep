import { Check, Layers } from "lucide-react";
import { Button, Card, Panel, PanelHeader, cx } from "@/components/ui";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { planAction } from "@/lib/billing/usage";
import type { PaidPlan } from "@/lib/billing/stripe";
import type { PlanId } from "@/lib/types";

const fmt = (n: number) => n.toLocaleString("en-US");

export interface PlansPanelProps {
  current: PlanId;
  /** Project has a Stripe subscription, so plan changes and cancelling go through the portal. */
  hasSubscription: boolean;
  /** Stripe has a customer for this project (the portal needs one). */
  hasCustomer: boolean;
  configured: boolean;
  /** Demo mode: show the plans but no actions at all. */
  readOnly?: boolean;
  prices: Record<PaidPlan, boolean>;
}

function PlanButton({ plan, props }: { plan: PlanId; props: PlansPanelProps }) {
  const { current, hasSubscription, configured, readOnly, prices } = props;
  const action = planAction(current, plan);
  if (action === "current") {
    return <span className="inline-flex h-8 items-center text-[12px] text-muted">Your current plan</span>;
  }
  if (readOnly) return null;
  const label = action === "upgrade" ? "Upgrade" : "Downgrade";
  if (!configured) return <Button disabled>{label}</Button>;

  // Moving between plans or cancelling an existing subscription happens in the Stripe portal.
  if (hasSubscription) {
    return (
      <form action="/api/stripe/portal" method="post">
        <Button type="submit" variant={action === "upgrade" ? "primary" : "secondary"}>
          {plan === "free" ? "Cancel plan" : label}
        </Button>
      </form>
    );
  }
  if (plan === "free") return <span className="inline-flex h-8 items-center text-[12px] text-muted">No subscription</span>;
  if (!prices[plan as PaidPlan]) return <Button disabled title="Price id not set">{label}</Button>;
  return (
    <form action="/api/stripe/checkout" method="post">
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" variant="primary">
        {label}
      </Button>
    </form>
  );
}

export function PlansPanel(props: PlansPanelProps) {
  const { current, hasSubscription, hasCustomer, configured } = props;
  return (
    <Panel>
      <PanelHeader
        icon={<Layers size={14} strokeWidth={1.75} />}
        title="Plans"
        subtitle="Monthly, cancel anytime"
        right={
          configured && hasCustomer && !props.readOnly ? (
            <form action="/api/stripe/portal" method="post">
              <Button type="submit" variant="ghost">
                Manage or cancel
              </Button>
            </form>
          ) : null
        }
      />
      <div className="grid gap-3 p-4 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const isCurrent = id === current;
          return (
            <Card key={id} className={cx("flex flex-col p-4", isCurrent && "border-line-2 bg-raised")}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink">{plan.name}</span>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-allow">
                    <Check size={12} strokeWidth={2} /> Current
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="tabular text-[26px] font-light leading-none tracking-tight text-ink">
                  ${plan.priceMonthly}
                </span>
                <span className="text-[12px] text-muted">/ month</span>
              </div>
              <div className="mt-2 text-[12px] text-ink-2">{fmt(plan.checksPerMonth)} checks a month</div>
              <p className="mt-1 flex-1 text-[12px] text-muted">{plan.blurb}</p>
              <div className="mt-4">
                <PlanButton plan={id} props={props} />
              </div>
            </Card>
          );
        })}
      </div>
      {hasSubscription && (
        <p className="px-4 pb-4 text-[12px] text-muted">
          Plan changes and cancellations open the Stripe portal. A cancelled plan stays active until the end of the
          period you paid for.
        </p>
      )}
    </Panel>
  );
}
