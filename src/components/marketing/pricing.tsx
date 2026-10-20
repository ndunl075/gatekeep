import { Check } from "lucide-react";
import { Card, ButtonLink, MonoLabel, cx } from "@/components/ui";
import { PLANS, PLAN_ORDER } from "@/lib/plans";

const fmt = (n: number) => n.toLocaleString("en-US");

const POINTS: Record<string, string[]> = {
  free: ["Every check and signal", "Dashboard and check log", "No card needed"],
  pro: ["Everything in Free", "Room for a real launch", "Cancel anytime"],
  scale: ["Everything in Pro", "10x the Pro checks", "Cancel anytime"],
};

export function PlanCards({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {PLAN_ORDER.map((id) => {
        const p = PLANS[id];
        const featured = id === "pro";
        return (
          <Card
            key={id}
            className={cx("flex flex-col p-5 sm:p-6", featured && "border-line-2 bg-panel")}
          >
            <MonoLabel>{p.name}</MonoLabel>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="tabular text-[44px] font-light leading-none tracking-tight text-ink">${p.priceMonthly}</span>
              <span className="text-[13px] text-muted">/ month</span>
            </div>
            <div className="mt-2 text-[14px] text-ink-2">{fmt(p.checksPerMonth)} checks a month</div>
            <p className="mt-1 text-[13px] text-muted">{p.blurb}</p>
            {detailed && (
              <ul className="mt-5 space-y-2 border-t border-line pt-4">
                {POINTS[id].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <Check size={14} className="mt-0.5 shrink-0 text-allow" />
                    {t}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-6">
              <ButtonLink href="/dashboard/billing" variant={featured ? "primary" : "secondary"} className="w-full">
                {p.priceMonthly === 0 ? "Start free" : `Get ${p.name}`}
              </ButtonLink>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
