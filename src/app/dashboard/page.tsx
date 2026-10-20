import { Coins, BarChart3 } from "lucide-react";
import { AppContent } from "@/components/ui/app-window";
import { PageTitle, Panel, PanelHeader, Segmented, StatCard } from "@/components/ui";
import { ChartLegend, StackedBars } from "@/components/dashboard/stacked-bars";
import { MapPanel } from "@/components/dashboard/map-panel";
import { QuotaBar } from "@/components/dashboard/quota-bar";
import { Greeting } from "@/components/dashboard/greeting";
import {
  RANGES,
  creditsSavedCents,
  formatCount,
  formatDollars,
  parseRange,
  summarySentence,
  totals,
} from "@/components/dashboard/helpers";
import { averageScoreSince, rangeStartIso } from "@/components/dashboard/queries";
import { PLANS } from "@/lib/plans";
import { getCurrentProject, getCurrentUser } from "@/lib/session";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range);
  const [project, user] = await Promise.all([getCurrentProject(), getCurrentUser()]);
  const store = getStore();

  const [days, signals, recentBlocks, avg, used] = await Promise.all([
    store.dailyStats(project.id, range),
    store.topSignals(project.id, range),
    store.listChecks(project.id, { decision: "block", limit: 5 }),
    averageScoreSince(store, project.id, rangeStartIso(range)),
    store.monthlyUsage(project.id),
  ]);

  const t = totals(days);
  const saved = creditsSavedCents(t.block, project.credit_value_cents);
  const plan = PLANS[project.plan];
  const first = user?.email.split("@")[0] ?? "there";
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  return (
    <AppContent>
      <PageTitle
        sub={summarySentence(range, t, saved)}
        right={
          <Segmented
            value={String(range)}
            items={RANGES.map((r) => ({ value: String(r), label: `${r}d`, href: `/dashboard?range=${r}` }))}
          />
        }
      >
        <Greeting name={name} />
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Signups checked" value={formatCount(t.checked)} unit={`${range}d`} foot={`${formatCount(t.allow)} allowed`} />
        <StatCard title="Blocked" value={formatCount(t.block)} accent="var(--color-block)" foot="Score at or above block threshold" />
        <StatCard title="Challenged" value={formatCount(t.challenge)} accent="var(--color-challenge)" foot="Worth a second look" />
        <StatCard
          title="Est. credits saved"
          value={formatDollars(saved)}
          foot={`Only blocks count · ${formatDollars(project.credit_value_cents)} each`}
        />
      </div>

      <Panel className="mt-4">
        <PanelHeader icon={<BarChart3 size={14} />} title="Checks per day" subtitle={`Last ${range} days, UTC`} right={<ChartLegend />} />
        <div className="px-4 pb-4 pt-8">
          <StackedBars days={days} />
        </div>
      </Panel>

      <div className="mt-4">
        <MapPanel
          rangeDays={range}
          signals={signals}
          checked={t.checked}
          avgScore={avg.avg}
          blocked={t.block}
          challenged={t.challenge}
          recentBlocks={recentBlocks}
        />
      </div>

      <Panel className="mt-4">
        <PanelHeader icon={<Coins size={14} />} title="Monthly quota" subtitle="Resets on the 1st (UTC)" />
        <div className="p-4">
          <QuotaBar used={used} limit={plan.checksPerMonth} planName={plan.name} />
        </div>
      </Panel>
    </AppContent>
  );
}
