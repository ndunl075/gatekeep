import { cx } from "@/components/ui";
import { formatCount, quotaPercent } from "./helpers";

/** Thin progress bar for the monthly check quota. */
export function QuotaBar({ used, limit, planName }: { used: number; limit: number; planName: string }) {
  const pct = quotaPercent(used, limit);
  const over = used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-muted">
          <span className="tabular text-[15px] font-light text-ink">{formatCount(used)}</span> of {formatCount(limit)} checks this month
        </span>
        <span className="text-muted">{planName} plan</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx("h-full rounded-full", over ? "bg-block" : pct >= 80 ? "bg-challenge" : "bg-ink-2")} style={{ width: `${pct}%` }} />
      </div>
      {over && <p className="mt-1.5 text-[11px] text-block">Over quota. Checks still run (gatekeep fails open) but you should upgrade.</p>}
    </div>
  );
}
