// Pure helpers behind the billing page, kept out of the components so they can be tested.
import { PLANS, PLAN_ORDER } from "../plans";
import type { PlanId } from "../types";

export interface UsageSummary {
  used: number;
  quota: number;
  /** 0-100, share of the quota used (capped at 100). */
  usedPct: number;
  /** 0-100, share left. This is the "72% left" in the ring. */
  leftPct: number;
  over: boolean;
  /** Start of the next UTC month, when the counter resets (matches Store.monthlyUsage). */
  resetsAt: Date;
}

export function usageSummary(plan: PlanId, used: number, now = new Date()): UsageSummary {
  const quota = PLANS[plan].checksPerMonth;
  const usedPct = Math.min(100, Math.round((used / quota) * 100));
  return {
    used,
    quota,
    usedPct,
    leftPct: 100 - usedPct,
    over: used >= quota,
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export type PlanAction = "current" | "upgrade" | "downgrade";

export function planAction(current: PlanId, target: PlanId): PlanAction {
  if (current === target) return "current";
  return PLAN_ORDER.indexOf(target) > PLAN_ORDER.indexOf(current) ? "upgrade" : "downgrade";
}
