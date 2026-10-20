// Static product shots for the landing page. Built from the real UI primitives and demo data,
// no store access, so the page can be rendered statically.
import { ArrowLeft, AtSign, Cpu, Globe } from "lucide-react";
import type { ReactNode } from "react";
import { AppWindow } from "@/components/ui/app-window";
import { Card, DecisionBadge, MonoLabel, Panel, PanelHeader, StatCard, cx, decisionColor } from "@/components/ui";
import { DEMO_PROJECT_ID, generateDemoChecks } from "@/lib/demo";
import type { DailyStat, Decision } from "@/lib/types";

// Fixed clock so the shot is identical on every build.
const NOW = Date.UTC(2026, 9, 14, 18, 0, 0);
const CREDIT_CENTS = 50;

function demo() {
  const checks = generateDemoChecks(DEMO_PROJECT_ID, 14, NOW);
  const days = new Map<string, DailyStat>();
  for (const c of checks) {
    const date = c.created_at.slice(0, 10);
    const d = days.get(date) ?? { date, allow: 0, challenge: 0, block: 0 };
    d[c.decision]++;
    days.set(date, d);
  }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const total = checks.length;
  const blocked = checks.filter((c) => c.decision === "block").length;
  const challenged = checks.filter((c) => c.decision === "challenge").length;
  return { daily, total, blocked, challenged };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function ShotBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[980px] px-3 py-5 sm:px-6 sm:py-7">{children}</div>;
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted">
      {(["allow", "challenge", "block"] as Decision[]).map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5 capitalize">
          <span className="size-1.5 rounded-full" style={{ background: decisionColor[d] }} />
          {d}
        </span>
      ))}
    </div>
  );
}

/** Hero shot: the Overview with stat cards and the 14-day stacked bars. */
export function OverviewShot() {
  const { daily, total, blocked, challenged } = demo();
  const max = Math.max(...daily.map((d) => d.allow + d.challenge + d.block));
  const saved = blocked * CREDIT_CENTS;
  return (
    <AppWindow active="overview" framed linkTabs={false}>
      <ShotBody>
        <p className="text-[22px] font-light leading-tight tracking-tight text-ink sm:text-[28px]">Good evening, Maya</p>
        <p className="mb-4 mt-1 text-[12px] text-muted sm:mb-5 sm:text-[13px]">
          Last 14 days: {fmt(blocked)} throwaway signups blocked, {fmt(challenged)} sent to a challenge.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard title="Checked" value={fmt(total)} unit={<span className="hidden sm:inline">signups</span>} foot="Last 14 days" />
          <StatCard title="Blocked" value={fmt(blocked)} unit={<span className="hidden sm:inline">signups</span>} foot={`${Math.round((blocked / total) * 100)}% of all`} accent={decisionColor.block} />
          <StatCard title={<><span className="sm:hidden">Saved</span><span className="hidden sm:inline">Credits saved</span></>} value={usd(saved)} unit={<span className="hidden sm:inline">est.</span>} foot={`Blocks x $${(CREDIT_CENTS / 100).toFixed(2)} each`} accent={decisionColor.allow} />
        </div>
        <Panel className="mt-3 sm:mt-4">
          <PanelHeader title="Signups per day" subtitle="Allow, challenge and block" right={<Legend />} className="[&_.min-w-0]:hidden sm:[&_.min-w-0]:block" />
          <div className="px-3 pb-3 pt-4 sm:px-4 sm:pb-4">
            <div className="flex h-[120px] items-end gap-1 sm:h-[170px] sm:gap-2">
              {daily.map((d) => {
                const sum = d.allow + d.challenge + d.block;
                return (
                  <div key={d.date} className="flex h-full flex-1 flex-col justify-end">
                    <div className="flex flex-col-reverse overflow-hidden rounded-t-[3px]" style={{ height: `${(sum / max) * 100}%` }}>
                      {(["allow", "challenge", "block"] as Decision[]).map((k) => (
                        <div key={k} style={{ height: `${(d[k] / sum) * 100}%`, background: decisionColor[k] }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1 sm:gap-2">
              {daily.map((d) => (
                <span key={d.date} className="flex-1 text-center font-mono text-[9px] text-faint sm:text-[10px]">
                  {"SMTWTFS"[new Date(d.date + "T00:00:00Z").getUTCDay()]}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </ShotBody>
    </AppWindow>
  );
}

function SourceCard({ icon, title, foot, n }: { icon: ReactNode; title: string; foot: string; n: string }) {
  return (
    <Card className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-raised text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-ink">{title}</div>
        <div className="truncate text-[11px] text-muted">{foot}</div>
      </div>
      <span className="tabular text-[15px] font-light text-ink">{n}</span>
    </Card>
  );
}

/** Map shot: signals into steps into decisions. */
export function MapShot() {
  return (
    <AppWindow active="overview" framed linkTabs={false}>
      <ShotBody>
        <p className="text-[22px] font-light leading-tight tracking-tight text-ink sm:text-[28px]">Your map</p>
        <p className="mb-4 mt-1 text-[12px] leading-relaxed text-muted sm:text-[13px]">
          Today gatekeep read 412 signups. 31 were blocked and 11 wait for a phone or card check.
        </p>
        <Panel className="p-3 sm:p-4">
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_28px_1.25fr_28px_1fr] sm:gap-0">
            <div className="space-y-2">
              <MonoLabel className="mb-1">Inputs</MonoLabel>
              <SourceCard icon={<AtSign size={14} />} title="Email" foot="n.ico+7@gmail.com" n="412" />
              <SourceCard icon={<Globe size={14} />} title="IP address" foot="185.220.101.7" n="412" />
              <SourceCard icon={<Cpu size={14} />} title="User agent" foot="python-requests" n="412" />
            </div>
            <Line />
            <div className="space-y-2">
              <MonoLabel className="mb-1">Checks</MonoLabel>
              {[
                ["Normalize the email", "Dots and +tags removed", "412"],
                ["Look up the domain", "Disposable list, MX records", "412"],
                ["Look at the crowd", "Same IP or device, bursts", "412"],
              ].map(([t, f, n], i) => (
                <Card key={t} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                    <span className="grid size-4 place-items-center rounded-full bg-white text-[10px] font-semibold text-black">{i + 1}</span>
                    {t}
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-muted">{f}</span>
                    <span className="tabular text-[15px] font-light text-ink">{n}</span>
                  </div>
                </Card>
              ))}
            </div>
            <Line />
            <div className="space-y-2">
              <MonoLabel className="mb-1">Decisions</MonoLabel>
              {(
                [
                  ["allow", "370", "Let in"],
                  ["challenge", "11", "Verify a phone or card"],
                  ["block", "31", "Stopped at the door"],
                ] as [Decision, string, string][]
              ).map(([d, n, f]) => (
                <Card key={d} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <DecisionBadge decision={d} />
                    <span className="tabular text-[15px] font-light text-ink">{n}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-muted">{f}</div>
                </Card>
              ))}
            </div>
          </div>
        </Panel>
      </ShotBody>
    </AppWindow>
  );
}

/** A thin 1px connector between map columns (hidden when the columns stack). */
function Line() {
  return (
    <div className="hidden h-px w-full bg-line-2 sm:block" aria-hidden />
  );
}

function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1 text-[12px]">
      <span className="w-[72px] shrink-0 text-muted sm:w-[88px]">{k}</span>
      <span className={cx("min-w-0 truncate text-ink-2", mono && "font-mono text-[11px]")}>{v}</span>
    </div>
  );
}

/** Check-detail shot: key/value block and the signals behind the decision, like the real detail page. */
export function CheckDetailShot() {
  const signals: [string, number, string][] = [
    ["email_reuse", 35, "nico@gmail.com already signed up 4 times"],
    ["plus_alias", 10, "Uses a +alias of n.ico@gmail.com"],
    ["dot_alias", 10, "Dots in a Gmail address are ignored by Gmail"],
  ];
  return (
    <AppWindow active="checks" framed linkTabs={false}>
      <ShotBody>
        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-muted">
          <ArrowLeft size={13} /> Back to checks
        </div>
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-[16px] font-semibold tracking-tight text-ink">n.ico+7@gmail.com</p>
            <DecisionBadge decision="challenge" />
          </div>
          <div className="mt-3 border-t border-line pt-2">
            <KV k="Score" v="55 of 100" />
            <KV k="Normalized" v="nico@gmail.com" mono />
            <KV k="IP" v="84.12.200.31" mono />
            <KV k="Device" v="Safari on macOS" />
            <KV k="Checked" v="31 ms" />
          </div>
          <MonoLabel className="mb-1.5 mt-4">Why</MonoLabel>
          <ul className="space-y-1.5">
            {signals.map(([id, pts, detail]) => (
              <li key={id} className="flex items-start gap-2 text-[12px]">
                <span className="mt-0.5 shrink-0 rounded-[4px] border border-line bg-panel px-1.5 font-mono text-[10px] text-challenge">+{pts}</span>
                <span className="min-w-0 text-ink-2">{detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      </ShotBody>
    </AppWindow>
  );
}
