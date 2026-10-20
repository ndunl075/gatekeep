import type { SupabaseClient } from "@supabase/supabase-js";
import type { Counters } from "../store/types";
import { COUNTER_TIMEOUT_MS, withTimeout } from "./util";

export type ParsedKey =
  | { projectId: string; column: "ip" | "device_id" | "normalized_email"; value: string }
  | { projectId: string; column: null };

const COLUMN = { ip: "ip", dev: "device_id", em: "normalized_email" } as const;

/** `gk:{projectId}:ip:{ip}` | `dev:{id}` | `em:{normalized}` | `burst`. The value may itself contain colons (IPv6). */
export function parseKey(key: string): ParsedKey | null {
  const m = /^gk:([^:]+):(?:(ip|dev|em):(.+)|(burst))$/.exec(key);
  if (!m) return null;
  return m[4] ? { projectId: m[1], column: null } : { projectId: m[1], column: COLUMN[m[2] as keyof typeof COLUMN], value: m[3] };
}

/** The daily project-wide burst baseline barely moves in a minute; reuse it rather than count a day of rows per check. */
const WIDE_WINDOW_SEC = 3600;
const WIDE_CACHE_MS = 60_000;
const WIDE_CACHE_MAX = 1000;

/**
 * Counters answered from the `checks` table, for deployments with Supabase but no Upstash. Checks are inserted
 * after the engine runs, so `hit` is the count so far plus the current check.
 */
export class PostgresCounters implements Counters {
  private wide = new Map<string, { value: number; expires: number }>();

  constructor(
    private client: SupabaseClient,
    private now: () => number = Date.now,
    private timeoutMs = COUNTER_TIMEOUT_MS,
  ) {}

  async hit(key: string, windowSec: number): Promise<number> {
    return (await this.count(key, windowSec)) + 1;
  }

  async count(key: string, windowSec: number): Promise<number> {
    const parsed = parseKey(key);
    if (!parsed) throw new Error(`postgres counters do not support key "${key}"`);

    const cacheKey = parsed.column === null && windowSec >= WIDE_WINDOW_SEC ? `${key}|${windowSec}` : null;
    if (cacheKey) {
      const cached = this.wide.get(cacheKey);
      if (cached && cached.expires > this.now()) return cached.value;
    }

    const since = new Date(this.now() - windowSec * 1000).toISOString();
    const controller = new AbortController();
    let query = this.client
      .from("checks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", parsed.projectId)
      .gt("created_at", since)
      .abortSignal(controller.signal);
    if (parsed.column) query = query.eq(parsed.column, parsed.value);

    let result;
    try {
      result = await withTimeout(query, this.timeoutMs, "postgres counters");
    } catch (err) {
      controller.abort();
      throw err;
    }
    if (result.error) throw new Error(`postgres counters: ${result.error.message}`);
    const value = result.count ?? 0;

    if (cacheKey) {
      if (this.wide.size >= WIDE_CACHE_MAX) this.wide.clear();
      this.wide.set(cacheKey, { value, expires: this.now() + WIDE_CACHE_MS });
    }
    return value;
  }
}
