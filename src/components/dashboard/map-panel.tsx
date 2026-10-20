import Link from "next/link";
import { Ban, Eye, ScanSearch } from "lucide-react";
import { Card, MonoLabel, Panel, PanelHeader } from "@/components/ui";
import type { CheckLog, SignalId } from "@/lib/types";
import { formatCount, formatTime, signalLabel } from "./helpers";

const Connector = () => (
  <div className="hidden items-center lg:flex" aria-hidden>
    <div className="h-px w-6 bg-line-2" />
  </div>
);

/** Dugg "Map": what gatekeep sees → what it does → recent blocks, joined by 1px connectors. */
export function MapPanel({
  rangeDays,
  signals,
  checked,
  avgScore,
  blocked,
  challenged,
  recentBlocks,
}: {
  rangeDays: number;
  signals: { id: SignalId; count: number }[];
  checked: number;
  avgScore: number | null;
  blocked: number;
  challenged: number;
  recentBlocks: CheckLog[];
}) {
  const steps = [
    { n: 1, title: "Checks each signup", line: `${formatCount(checked)} checked`, foot: `last ${rangeDays} days` },
    {
      n: 2,
      title: "Scores the risk",
      line: avgScore === null ? "no scores yet" : `avg score ${avgScore}`,
      foot: "0 clean · 100 certain abuse",
    },
    {
      n: 3,
      title: "Decides",
      line: `${formatCount(blocked)} blocked · ${formatCount(challenged)} challenged`,
      foot: "the rest are allowed",
    },
  ];
  return (
    <Panel>
      <PanelHeader icon={<ScanSearch size={14} />} title="Your map" subtitle="From signal to decision" />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="min-w-0 space-y-2">
          <MonoLabel className="mb-1">What gatekeep sees</MonoLabel>
          {signals.length === 0 && <Card className="px-3 py-3 text-[12px] text-muted">No signals fired in this range.</Card>}
          {signals.slice(0, 5).map((s) => (
            <Card key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-panel text-muted">
                <Eye size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-ink">{signalLabel(s.id)}</div>
                <div className="truncate font-mono text-[10px] text-faint">{s.id}</div>
              </div>
              <div className="text-right">
                <div className="tabular text-[15px] font-light leading-none text-ink">{formatCount(s.count)}</div>
                <div className="mt-0.5 text-[10px] text-muted">hits</div>
              </div>
            </Card>
          ))}
        </div>
        <Connector />
        <div className="min-w-0 space-y-2">
          <MonoLabel className="mb-1">What gatekeep does</MonoLabel>
          {steps.map((s) => (
            <Card key={s.n} className="px-3 py-2.5">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <span className="grid size-4 place-items-center rounded-full bg-white text-[10px] font-semibold text-black">{s.n}</span>
                {s.title}
              </div>
              <div className="tabular mt-1.5 text-[13px] text-ink-2">{s.line}</div>
              <div className="mt-0.5 text-[11px] text-muted">{s.foot}</div>
            </Card>
          ))}
        </div>
        <Connector />
        <div className="min-w-0 space-y-2">
          <MonoLabel className="mb-1">Recent blocks</MonoLabel>
          {recentBlocks.length === 0 && <Card className="px-3 py-3 text-[12px] text-muted">Nothing blocked yet.</Card>}
          {recentBlocks.map((c) => (
            <Link key={c.id} href={`/dashboard/checks/${c.id}`} className="block">
              <Card className="px-3 py-2.5 transition-colors hover:bg-raised">
                <div className="flex items-center gap-2">
                  <Ban size={12} className="shrink-0 text-block" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.email}</span>
                  <span className="tabular font-mono text-[11px] text-ink-2">{c.score}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                  <span className="truncate">{c.reason}</span>
                  <span className="shrink-0">{formatTime(c.created_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </Panel>
  );
}

