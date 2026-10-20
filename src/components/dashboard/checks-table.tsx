import Link from "next/link";
import { DecisionBadge } from "@/components/ui";
import type { CheckLog } from "@/lib/types";
import { formatTime } from "./helpers";

/** Checks table. Scrolls horizontally inside its own wrapper on narrow screens. */
export function ChecksTable({ checks }: { checks: CheckLog[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <th className="px-4 py-2.5 font-normal">Time (UTC)</th>
            <th className="px-2 py-2.5 font-normal">Email</th>
            <th className="px-2 py-2.5 font-normal">Decision</th>
            <th className="px-2 py-2.5 font-normal">Score</th>
            <th className="px-2 py-2.5 font-normal">Top reason</th>
            <th className="px-4 py-2.5 font-normal">IP</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-card">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatTime(c.created_at)}</td>
              <td className="max-w-[240px] truncate px-2 py-2.5">
                <Link href={`/dashboard/checks/${c.id}`} className="text-ink hover:underline">
                  {c.email}
                </Link>
              </td>
              <td className="px-2 py-2.5">
                <DecisionBadge decision={c.decision} />
              </td>
              <td className="tabular px-2 py-2.5 font-mono text-ink-2">{c.score}</td>
              <td className="max-w-[260px] truncate px-2 py-2.5 text-muted">{c.reason || "No signals"}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-muted">{c.ip ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
