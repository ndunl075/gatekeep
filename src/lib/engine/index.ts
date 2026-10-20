import type { CheckInput, Decision, Signal } from "../types";
import type { Counters } from "../store/types";
import { botUserAgent } from "./bot";
import { matchDisposable } from "./disposable";
import { gibberishEmailLocal, gibberishName } from "./gibberish";
import { parseEmail } from "./normalize";

export { normalizeEmail } from "./normalize";
export type { NormalizedEmail } from "./normalize";
export { isDisposableDomain, matchDisposable } from "./disposable";
export { gibberishEmailLocal, gibberishName } from "./gibberish";
export { botUserAgent } from "./bot";

export interface EngineContext {
  projectId: string;
  counters: Counters;
  /** true/false = MX (or A fallback) present/absent; null = unknown (timeout/error) → no signal. */
  resolveMx: (domain: string) => Promise<boolean | null>;
  thresholds: { challenge: number; block: number };
  /** True when the caller only wants to score, not record (playground "dry run"). */
  dryRun?: boolean;
}

export interface EngineResult {
  decision: Decision;
  score: number;
  reason: string;
  signals: Signal[];
  normalized_email: string;
  email_domain: string;
  /**
   * Set when a dependency failed and its signals were skipped (fail open): "mx_error", "counters_error".
   * Engine-internal; the API can log it.
   */
  degraded?: string[];
}

const DAY = 86_400;
const REUSE_WINDOW = 30 * DAY;
const BURST_WINDOW = 600;
const BURST_MIN = 20;
const BURST_FACTOR = 5;
/** Number of 10 minute buckets in 24h, for the trailing average. */
const BUCKETS_PER_DAY = DAY / BURST_WINDOW;
const MAX_KEY_PART = 128;

function decide(score: number, t: EngineContext["thresholds"]): Decision {
  return score >= t.block ? "block" : score >= t.challenge ? "challenge" : "allow";
}

function keyPart(s: string): string {
  return s.trim().toLowerCase().slice(0, MAX_KEY_PART);
}

/**
 * Records (or, in dry-run, only reads) one counter. Always returns the count *including* the current check,
 * so a dry run scores exactly like the real call would. Counter failures degrade to "no signal".
 */
async function tally(ctx: EngineContext, key: string, windowSec: number, degraded: Set<string>): Promise<number | null> {
  try {
    const k = `gk:${ctx.projectId}:${key}`;
    return ctx.dryRun ? (await ctx.counters.count(k, windowSec)) + 1 : await ctx.counters.hit(k, windowSec);
  } catch {
    degraded.add("counters_error");
    return null;
  }
}

async function burstCounts(ctx: EngineContext, degraded: Set<string>): Promise<{ recent: number; day: number } | null> {
  try {
    const key = `gk:${ctx.projectId}:burst`;
    const [recent, day] = await Promise.all([
      tally(ctx, "burst", BURST_WINDOW, degraded),
      ctx.counters.count(key, DAY),
    ]);
    if (recent === null) return null;
    // The 24h window must contain the 10 minute one; `day` may or may not include this check's own hit.
    return { recent, day: Math.max(day + (ctx.dryRun ? 1 : 0), recent) };
  } catch {
    degraded.add("counters_error");
    return null;
  }
}

async function mx(ctx: EngineContext, domain: string, degraded: Set<string>): Promise<boolean | null> {
  try {
    return await ctx.resolveMx(domain);
  } catch {
    degraded.add("mx_error");
    return null;
  }
}

function velocity(id: "ip_velocity" | "device_velocity", count: number | null, noun: string): Signal | null {
  if (count === null || count < 3) return null;
  return { id, points: count >= 6 ? 60 : 45, detail: `${count} checks from this ${noun} in 24h` };
}

export async function runChecks(input: CheckInput, ctx: EngineContext): Promise<EngineResult> {
  const parsed = parseEmail(input.email);
  if (!parsed) {
    const typed = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const at = typed.lastIndexOf("@");
    return {
      decision: "block",
      score: 100,
      reason: "Email address is not valid",
      signals: [{ id: "invalid_email", points: 100, detail: "Email address is not valid" }],
      normalized_email: typed,
      email_domain: at === -1 ? "" : typed.slice(at + 1),
    };
  }

  // Callers are JSON from the wire: anything that is not a non-empty string counts as absent.
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
  const ipRaw = str(input.ip);
  const deviceRaw = str(input.device_id);
  const name = str(input.name);
  const ip = ipRaw ? keyPart(ipRaw) : null;
  const device = deviceRaw ? keyPart(deviceRaw) : null;
  const degraded = new Set<string>();

  // Independent lookups run together: MX plus every counter.
  const [hasMx, ipCount, devCount, emailCount, burst] = await Promise.all([
    mx(ctx, parsed.domain, degraded),
    ip ? tally(ctx, `ip:${ip}`, DAY, degraded) : null,
    device ? tally(ctx, `dev:${device}`, DAY, degraded) : null,
    tally(ctx, `em:${parsed.normalized}`, REUSE_WINDOW, degraded),
    burstCounts(ctx, degraded),
  ]);

  const signals: Signal[] = [];
  const add = (s: Signal | null) => s && signals.push(s);

  const disposable = matchDisposable(parsed.domain);
  if (disposable) {
    add({ id: "disposable_domain", points: 80, detail: `Disposable email domain (${disposable})` });
  }
  if (hasMx === false) {
    add({ id: "no_mx", points: 70, detail: `Domain ${parsed.domain} has no mail server` });
  }
  add(velocity("ip_velocity", ipCount, "IP"));
  add(velocity("device_velocity", devCount, "device"));
  if (emailCount !== null && emailCount >= 2) {
    add({ id: "email_reuse", points: 35, detail: "This email was already checked in the last 30 days" });
  }
  const bot = botUserAgent(input.user_agent);
  if (bot) {
    add({
      id: "bot_user_agent",
      points: 30,
      detail: bot === "missing" ? "User agent is missing" : `User agent looks automated (${bot})`,
    });
  }
  if (burst && burst.recent >= BURST_MIN && burst.recent >= BURST_FACTOR * (burst.day / BUCKETS_PER_DAY)) {
    add({
      id: "signup_burst",
      points: 25,
      detail: `Signup burst: ${burst.recent} checks in the last 10 minutes`,
    });
  }
  if (gibberishEmailLocal(parsed.displayLocal)) {
    add({ id: "gibberish_email", points: 25, detail: "Email name looks machine generated" });
  }
  if (name && gibberishName(name)) {
    add({ id: "gibberish_name", points: 20, detail: "Name looks like keyboard mash" });
  }
  if (parsed.plusAlias) {
    add({ id: "plus_alias", points: 10, detail: "Email uses a +tag alias" });
  }
  if (parsed.dotAlias) {
    add({ id: "dot_alias", points: 10, detail: "Gmail address uses dots to create an alias" });
  }

  // Array.prototype.sort is stable, so equal-point signals keep their evaluation order.
  signals.sort((a, b) => b.points - a.points);
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.points, 0));
  const reason = signals.length ? signals.slice(0, 2).map((s) => s.detail).join("; ") : "No risk signals";

  return {
    decision: decide(score, ctx.thresholds),
    score,
    reason,
    signals,
    normalized_email: parsed.normalized,
    email_domain: parsed.domain,
    ...(degraded.size ? { degraded: [...degraded].sort() } : {}),
  };
}
