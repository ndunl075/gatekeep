import { BarChart3 } from "lucide-react";
import { Card, MonoLabel, Panel, PanelHeader } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import type { UsageSummary } from "@/lib/billing/usage";
import type { PlanId } from "@/lib/types";
import { RingGauge } from "./ring-gauge";

const fmt = (n: number) => n.toLocaleString("en-US");
const resetLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function UsagePanel({ plan, usage }: { plan: PlanId; usage: UsageSummary }) {
  const color = usage.over
    ? "var(--color-block)"
    : usage.usedPct >= 80
      ? "var(--color-challenge)"
      : "var(--color-allow)";
  return (
    <Panel>
      <PanelHeader
        icon={<BarChart3 size={14} strokeWidth={1.75} />}
        title="This month"
        subtitle={`${PLANS[plan].name} plan · resets ${resetLabel(usage.resetsAt)} (UTC)`}
        right={<span className="text-[12px] text-muted">{fmt(usage.quota)} checks a month</span>}
      />
      <div className="flex flex-wrap items-center gap-6 p-4">
        <RingGauge percent={usage.leftPct} label="left" color={color} />
        <div className="min-w-[240px] flex-1">
          <MonoLabel>Checks used</MonoLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular text-[26px] font-light leading-none tracking-tight text-ink">{fmt(usage.used)}</span>
            <span className="text-[12px] text-muted">of {fmt(usage.quota)}</span>
          </div>
          <div
            className="mt-3 h-1 w-full overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usage.usedPct}
            aria-label="Checks used this month"
          >
            <div className="h-full rounded-full" style={{ width: `${usage.usedPct}%`, background: color }} />
          </div>
          <p className="mt-3 text-[12px] text-muted">
            {usage.over
              ? "You are over your monthly quota. Checks keep working and never block your signups, but upgrade to stay within your plan."
              : "Going over your quota never blocks a signup. gatekeep keeps checking and flags the response with quota_exceeded."}
          </p>
        </div>
      </div>
      <Card className="mx-4 mb-4 px-3.5 py-2.5 text-[12px] text-muted">
        Usage counts every check since the 1st of the month, UTC.
      </Card>
    </Panel>
  );
}
