import { after } from "next/server";
import { z } from "zod";
import { getCounters, getCountersName } from "./counters";
import { withTimeout } from "./counters/util";
import { DEMO_API_KEY } from "./demo";
import { runChecks, type EngineContext, type EngineResult } from "./engine";
import { hashKey } from "./keys";
import { resolveMx } from "./mx";
import { PLANS } from "./plans";
import { MemoryCounters } from "./store/memory";
import { getStore } from "./store";
import type { Counters, Store } from "./store/types";
import type { ApiKey, CheckInput, CheckLog, CheckResult, Project } from "./types";

/** Per API key. */
export const RATE_LIMIT_PER_MIN = 600;
/** Seconds a limited client is told to wait. */
const RETRY_AFTER_SEC = 10;
const USAGE_TTL_MS = 30_000;
/** Do not write api_keys.last_used_at more often than this. */
const TOUCH_INTERVAL_MS = 60_000;
const LOG_INTERVAL_MS = 60_000;
const MAX_KEY_PART = 128;
/** Everything between "key looked up" and "project, limits and usage known". A slow store must not stall signups. */
const AUTH_TIMEOUT_MS = 1000;
const USAGE_TIMEOUT_MS = 300;
/** Background / playground writes. */
const WRITE_TIMEOUT_MS = 5000;
const PLAYGROUND_WRITE_TIMEOUT_MS = 2000;
/** Unknown keys are remembered briefly so a scanner cannot turn every guess into a database read. */
const NEGATIVE_TTL_MS = 60_000;
const NEGATIVE_MAX = 1000;
/** What generateKey() produces, plus the public demo key. Anything else is rejected before hashing. */
const KEY_SHAPE = /^gk_live_[0-9A-Za-z]{40}$/;

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v ?? undefined);

// Unknown fields are stripped, so SDKs can send extra context without breaking.
const inputSchema = z.object({
  email: z.string({ error: "email is required and must be a string" }).min(1, "email is required").max(320),
  ip: optional(64),
  user_agent: optional(1024),
  device_id: optional(128),
  name: optional(200),
});

export interface ErrorBody {
  error: "invalid_request" | "unauthorized" | "rate_limited";
  message: string;
}

export type CheckOutcome =
  | { status: 200; body: CheckResult; latencyMs: number }
  | { status: 400 | 401; body: ErrorBody; latencyMs: number }
  | { status: 429; body: ErrorBody; latencyMs: number; retryAfterSec: number };

export interface CheckDeps {
  store: () => Store;
  counters: () => Counters;
  resolveMx: EngineContext["resolveMx"];
  runChecks: (input: CheckInput, ctx: EngineContext) => Promise<EngineResult>;
  /** Runs `fn` after the response is sent. Defaults to next/server `after()`. */
  defer: (fn: () => Promise<unknown>) => void;
  /** False when the configured counters cannot hold the per-key rate limit (Postgres): limit per instance. */
  sharedRateLimit: () => boolean;
  now: () => number;
}

function logFailure(what: string, err: unknown) {
  console.error(`[gatekeep] ${what}`, err);
}

const defaultDeps: CheckDeps = {
  store: getStore,
  counters: getCounters,
  resolveMx,
  runChecks,
  defer(fn) {
    const run = () => fn().catch((err) => logFailure("deferred work failed", err));
    try {
      after(run);
    } catch {
      // Outside a request scope (scripts, tests): just run it.
      void run();
    }
  },
  sharedRateLimit: () => getCountersName() !== "postgres",
  now: Date.now,
};

/** Same canonical form the engine uses for counter keys, so Postgres counters can match the stored rows. */
function keyPart(v: string | undefined): string | null {
  const s = v?.trim().toLowerCase().slice(0, MAX_KEY_PART);
  return s ? s : null;
}

function nonEmpty(v: string | undefined): string | null {
  return v && v.trim() ? v : null;
}

export function createCheckService(overrides: Partial<CheckDeps> = {}) {
  const deps: CheckDeps = { ...defaultDeps, ...overrides };
  const usage = new Map<string, { month: string; count: number; at: number }>();
  const lastLogged = new Map<string, number>();
  // Rate limiting must work even when the configured counters (Postgres) cannot hold arbitrary keys.
  const localLimiter = new MemoryCounters(deps.now);

  function logDegraded(projectId: string, degraded: string[] | undefined) {
    const t = deps.now();
    const fresh = (degraded ?? []).filter((d) => t - (lastLogged.get(d) ?? 0) >= LOG_INTERVAL_MS);
    if (!fresh.length) return;
    for (const d of fresh) lastLogged.set(d, t);
    console.warn(`[gatekeep] degraded check (fail open), project ${projectId}: ${fresh.join(", ")}`);
  }

  // sha256 of keys that did not resolve → expiry. Insertion ordered, refreshed on hit, oldest evicted.
  const unknownKeys = new Map<string, number>();

  function isKnownBad(hash: string): boolean {
    const expires = unknownKeys.get(hash);
    if (expires === undefined) return false;
    unknownKeys.delete(hash);
    if (expires <= deps.now()) return false;
    unknownKeys.set(hash, expires);
    return true;
  }

  function rememberBad(hash: string) {
    unknownKeys.delete(hash);
    unknownKeys.set(hash, deps.now() + NEGATIVE_TTL_MS);
    while (unknownKeys.size > NEGATIVE_MAX) {
      const oldest = unknownKeys.keys().next().value;
      if (oldest === undefined) break;
      unknownKeys.delete(oldest);
    }
  }

  /**
   * Over the limit? Postgres counters cannot hold arbitrary keys, so there (and whenever the backend errors)
   * the limit is per instance: approximate on serverless, but it never blocks a signup.
   */
  async function overRateLimit(keyId: string): Promise<boolean> {
    const k = `gk:rl:${keyId}`;
    if (!deps.sharedRateLimit()) return (await localLimiter.hit(k, 60)) > RATE_LIMIT_PER_MIN;
    try {
      return (await deps.counters().hit(k, 60)) > RATE_LIMIT_PER_MIN;
    } catch {
      return (await localLimiter.hit(k, 60)) > RATE_LIMIT_PER_MIN;
    }
  }

  /** Checks this month, cached briefly: a COUNT over the month's rows on every request is not worth it for a soft limit. */
  async function monthlyUsage(store: Store, projectId: string): Promise<number> {
    const t = deps.now();
    const month = new Date(t).toISOString().slice(0, 7);
    const cached = usage.get(projectId);
    if (cached && cached.month === month && t - cached.at < USAGE_TTL_MS) {
      cached.count++;
      return cached.count - 1;
    }
    const count = await withTimeout(store.monthlyUsage(projectId), USAGE_TIMEOUT_MS, "usage lookup");
    usage.set(projectId, { month, count: count + 1, at: t });
    if (usage.size > 5000) usage.clear();
    return count;
  }

  /** Scores one check. Fail open: any internal error becomes an allow with `error` set. */
  async function evaluate(
    project: Project,
    input: CheckInput,
    opts: { dryRun: boolean; startedAt: number; extra?: Partial<CheckResult>; persist: (log: CheckLog) => void | Promise<void> },
  ): Promise<CheckResult> {
    const id = crypto.randomUUID();
    try {
      const r = await deps.runChecks(input, {
        projectId: project.id,
        counters: deps.counters(),
        resolveMx: deps.resolveMx,
        thresholds: { challenge: project.challenge_threshold, block: project.block_threshold },
        dryRun: opts.dryRun,
      });
      logDegraded(project.id, r.degraded);
      const latency_ms = Math.max(0, Math.round(deps.now() - opts.startedAt));
      const result: CheckResult = {
        id,
        decision: r.decision,
        score: r.score,
        reason: r.reason,
        signals: r.signals,
        normalized_email: r.normalized_email,
        latency_ms,
        ...opts.extra,
      };
      if (!opts.dryRun) {
        // A failed write must not turn a real decision into an error.
        const log: CheckLog = {
          id,
          project_id: project.id,
          created_at: new Date(deps.now()).toISOString(),
          email: input.email,
          normalized_email: r.normalized_email,
          email_domain: r.email_domain,
          ip: keyPart(input.ip),
          user_agent: nonEmpty(input.user_agent),
          device_id: keyPart(input.device_id),
          decision: r.decision,
          score: r.score,
          reason: r.reason,
          signals: r.signals,
          latency_ms,
        };
        try {
          await opts.persist(log);
        } catch (err) {
          logFailure("could not record check", err);
        }
      }
      return result;
    } catch (err) {
      return failOpen(id, input.email, opts.startedAt, err, opts.extra);
    }
  }

  function failOpen(id: string, email: unknown, startedAt: number, err: unknown, extra?: Partial<CheckResult>): CheckResult {
    logFailure("check failed, allowing (fail open)", err);
    return {
      id,
      decision: "allow",
      score: 0,
      reason: "gatekeep error, allowed by default",
      signals: [],
      normalized_email: typeof email === "string" ? email.trim().toLowerCase() : "",
      latency_ms: Math.max(0, Math.round(deps.now() - startedAt)),
      ...extra,
      error: "internal_error",
    };
  }

  /** POST /api/v1/check. `body` is the already-parsed JSON. */
  async function runCheck(apiKeyPlaintext: string | null, body: unknown): Promise<CheckOutcome> {
    const startedAt = deps.now();
    const elapsed = () => Math.max(0, Math.round(deps.now() - startedAt));
    const bad = (status: 400 | 401, error: ErrorBody["error"], message: string): CheckOutcome => ({
      status,
      body: { error, message },
      latencyMs: elapsed(),
    });

    const unauthorized = (message = "Missing or invalid API key. Send it as 'Authorization: Bearer gk_live_...'.") =>
      bad(401, "unauthorized", message);

    // Cheap rejections first: no store, no hashing for keys that cannot be real.
    if (!apiKeyPlaintext || !(KEY_SHAPE.test(apiKeyPlaintext) || apiKeyPlaintext === DEMO_API_KEY)) return unauthorized();
    const keyHash = hashKey(apiKeyPlaintext);
    if (isKnownBad(keyHash)) return unauthorized();

    type Auth =
      | { ok: true; store: Store; key: ApiKey; project: Project; limited: boolean; used: number }
      | { ok: false; message?: string };
    let auth: Auth;
    try {
      auth = await withTimeout(
        (async (): Promise<Auth> => {
          const store = deps.store();
          const key = await store.findKeyByHash(keyHash);
          if (!key) {
            rememberBad(keyHash);
            return { ok: false };
          }
          const [project, limited, used] = await Promise.all([
            store.getProject(key.project_id),
            overRateLimit(key.id),
            monthlyUsage(store, key.project_id).catch((err) => {
              logFailure("usage lookup failed", err);
              return 0;
            }),
          ]);
          if (!project) return { ok: false, message: "This API key does not belong to a project." };
          return { ok: true, store, key, project, limited, used };
        })(),
        AUTH_TIMEOUT_MS,
        "store",
      );
    } catch (err) {
      // We cannot even identify the caller (store down, hung or misconfigured): that must not break their signup.
      const email = (body as { email?: unknown } | null)?.email;
      return { status: 200, body: failOpen(crypto.randomUUID(), email, startedAt, err), latencyMs: elapsed() };
    }
    if (!auth.ok) return unauthorized(auth.message);
    const { store, key, project, limited, used } = auth;

    if (limited) {
      return {
        status: 429,
        body: { error: "rate_limited", message: `Rate limit of ${RATE_LIMIT_PER_MIN} requests per minute exceeded.` },
        latencyMs: elapsed(),
        retryAfterSec: RETRY_AFTER_SEC,
      };
    }

    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".");
      return bad(400, "invalid_request", path && !issue.message.startsWith(path) ? `${path}: ${issue.message}` : (issue?.message ?? "Invalid request body"));
    }

    const quota = PLANS[project.plan]?.checksPerMonth;
    const keyRef = key;
    const result = await evaluate(project, parsed.data, {
      dryRun: false,
      startedAt,
      extra: quota !== undefined && used >= quota ? { quota_exceeded: true } : undefined,
      persist: (log) =>
        deps.defer(async () => {
          try {
            await withTimeout(store.insertCheck(log), WRITE_TIMEOUT_MS, "insertCheck");
            const lastUsed = keyRef.last_used_at ? Date.parse(keyRef.last_used_at) : 0;
            if (deps.now() - lastUsed >= TOUCH_INTERVAL_MS) await withTimeout(store.touchKey(keyRef.id), WRITE_TIMEOUT_MS, "touchKey");
          } catch (err) {
            logFailure("could not record check", err);
          }
        }),
    });
    return { status: 200, body: result, latencyMs: result.latency_ms };
  }

  /** Playground: the signed-in owner tests their own project. No key, no rate limit, no quota. */
  async function runCheckForProject(
    project: Project,
    input: CheckInput,
    { dryRun = false }: { dryRun?: boolean } = {},
  ): Promise<CheckResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
    return evaluate(project, parsed.data, {
      dryRun,
      startedAt: deps.now(),
      // Awaited, so the check is on the Checks page by the time the form shows the result.
      persist: (log) => withTimeout(deps.store().insertCheck(log), PLAYGROUND_WRITE_TIMEOUT_MS, "insertCheck"),
    });
  }

  return { runCheck, runCheckForProject };
}

const service = createCheckService();
export const runCheck = service.runCheck;
export const runCheckForProject = service.runCheckForProject;
