import type { PlanId } from "./types";

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  checksPerMonth: number;
  blurb: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceMonthly: 0, checksPerMonth: 500, blurb: "For trying it on a side project." },
  pro: { id: "pro", name: "Pro", priceMonthly: 29, checksPerMonth: 10_000, blurb: "For an app with real signups." },
  scale: { id: "scale", name: "Scale", priceMonthly: 99, checksPerMonth: 100_000, blurb: "For when the farmers find you." },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "scale"];
