// Pure helpers for the dashboard: range parsing, number formatting, chart scaling, copy.
import type { DailyStat, Decision, SignalId } from "@/lib/types";

export const RANGES = [7, 14, 30] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = 7;

/** Parses `?range=` (string or array form); anything unknown falls back to 7 days. */
export function parseRange(raw: string | string[] | undefined | null): Range {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt((v ?? "").replace(/d$/i, ""), 10);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : DEFAULT_RANGE;
}

/** Cents to a dollar string: "$107", "$0.50", "$1,284". Whole dollars drop the decimals. */
export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars) || Math.abs(dollars) >= 1000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(whole ? Math.round(dollars) : dollars);
}

export const formatCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

export function totals(days: DailyStat[]) {
  const t = { allow: 0, challenge: 0, block: 0, checked: 0 };
  for (const d of days) {
    t.allow += d.allow;
    t.challenge += d.challenge;
    t.block += d.block;
  }
  t.checked = t.allow + t.challenge + t.block;
  return t;
}

/** Est. credits saved, in cents. Only blocks count; challenged users may be real. */
export const creditsSavedCents = (blocked: number, creditValueCents: number) => blocked * creditValueCents;

/** "In the last 7 days gatekeep checked 812 signups, blocked 214 and challenged 61. That is about $107 ..." */
export function summarySentence(range: number, t: ReturnType<typeof totals>, savedCents: number): string {
  if (t.checked === 0) return `No signups were checked in the last ${range} days yet. Send a check to see it here.`;
  const base = `In the last ${range} days gatekeep checked ${formatCount(t.checked)} signups, blocked ${formatCount(
    t.block,
  )} and challenged ${formatCount(t.challenge)}.`;
  return savedCents > 0 ? `${base} That is about ${formatDollars(savedCents)} in free credits kept.` : base;
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Rounds up to a "nice" axis maximum (1, 2, 5 times a power of ten). Never below 1. */
export function niceMax(max: number): number {
  if (max <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

export const STACK_ORDER: Decision[] = ["allow", "challenge", "block"];

export interface BarSegment {
  decision: Decision;
  count: number;
  /** Height as a percentage of the chart height. */
  pct: number;
}

/** Stack segments for one day (allow at the bottom). Non-empty segments get at least `minPct` so they stay visible. */
export function barSegments(day: DailyStat, axisMax: number, minPct = 1.5): BarSegment[] {
  return STACK_ORDER.filter((d) => day[d] > 0).map((decision) => ({
    decision,
    count: day[decision],
    pct: Math.max(minPct, (day[decision] / axisMax) * 100),
  }));
}

export const weekdayLetter = (isoDate: string) => "SMTWTFS"[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 20" from YYYY-MM-DD or an ISO timestamp (UTC). */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Oct 20, 14:32" (UTC). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${formatDay(iso)}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const SIGNAL_LABELS: Record<SignalId, string> = {
  invalid_email: "Invalid email address",
  disposable_domain: "Disposable email domain",
  no_mx: "Domain cannot receive mail",
  plus_alias: "Plus-address alias",
  dot_alias: "Dotted Gmail alias",
  email_reuse: "Same inbox signed up again",
  ip_velocity: "Many signups from one IP",
  device_velocity: "Many signups from one device",
  signup_burst: "Sudden burst of signups",
  gibberish_name: "Keyboard-mash name",
  gibberish_email: "Machine-generated email",
  bot_user_agent: "Bot or missing user agent",
};

export const signalLabel = (id: string) => SIGNAL_LABELS[id as SignalId] ?? id;

export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
