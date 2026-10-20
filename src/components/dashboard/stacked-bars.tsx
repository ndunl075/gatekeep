"use client";
// 14-day style stacked bar chart (Dugg "Usage"): allow teal, challenge amber, block red.
import { useState } from "react";
import { cx, decisionColor } from "@/components/ui";
import type { DailyStat, Decision } from "@/lib/types";
import { barSegments, formatDay, formatCount, niceMax, STACK_ORDER, weekdayLetter } from "./helpers";

export function ChartLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted">
      {STACK_ORDER.map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5 capitalize">
          <span className="size-1.5 rounded-full" style={{ background: decisionColor[d] }} />
          {d}
        </span>
      ))}
    </div>
  );
}

export function StackedBars({ days, height = 160 }: { days: DailyStat[]; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const axisMax = niceMax(Math.max(0, ...days.map((d) => d.allow + d.challenge + d.block)));
  const n = days.length;
  const shown = active !== null ? days[active] : null;

  return (
    <div className="relative" onMouseLeave={() => setActive(null)}>
      <div className="relative" style={{ height }}>
        {[0, 50, 100].map((p) => (
          <div key={p} className="absolute inset-x-0 border-t border-line/70" style={{ bottom: `${p}%` }} />
        ))}
        <span className="tabular absolute -top-4 left-0 font-mono text-[10px] text-faint">{formatCount(axisMax)}</span>
        <div className="absolute inset-0 flex items-end">
          {days.map((d, i) => {
            const segs = barSegments(d, axisMax);
            return (
              <button
                key={d.date}
                type="button"
                aria-label={`${formatDay(d.date)}: ${d.allow} allowed, ${d.challenge} challenged, ${d.block} blocked`}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                <div
                  className={cx("flex w-[60%] max-w-[36px] flex-col-reverse gap-px transition-opacity", active !== null && active !== i && "opacity-60")}
                >
                  {segs.map((s, si) => (
                    <div
                      key={s.decision}
                      className={cx(si === segs.length - 1 && "rounded-t-[4px]")}
                      style={{ height: `${(s.pct / 100) * height}px`, background: decisionColor[s.decision] }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {shown && (
          <div
            className="pointer-events-none absolute z-10 w-36 -translate-x-1/2 rounded-md border border-line-2 bg-card p-2 text-[11px] shadow-none"
            style={{
              left: `clamp(72px, ${((active! + 0.5) / n) * 100}%, calc(100% - 72px))`,
              bottom: `${Math.min(90, ((shown.allow + shown.challenge + shown.block) / axisMax) * 100 + 6)}%`,
            }}
          >
            <div className="mb-1 text-ink">{formatDay(shown.date)}</div>
            {(["allow", "challenge", "block"] as Decision[]).map((d) => (
              <div key={d} className="flex items-center justify-between text-muted">
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <span className="size-1.5 rounded-full" style={{ background: decisionColor[d] }} />
                  {d}
                </span>
                <span className="tabular font-mono text-ink-2">{formatCount(shown[d])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex">
        {days.map((d) => (
          <span key={d.date} className="min-w-0 flex-1 text-center font-mono text-[10px] text-faint">
            {weekdayLetter(d.date)}
          </span>
        ))}
      </div>
    </div>
  );
}
