import { env, hasSupabase, hasUpstash } from "../env";
import { MemoryCounters } from "../store/memory";
import type { Counters } from "../store/types";
import { getAdminClient } from "../supabase/admin";
import { PostgresCounters } from "./postgres";
import { createUpstashCounters } from "./upstash";

export type CountersName = "upstash" | "postgres" | "memory";

const g = globalThis as unknown as { __gatekeepCounters?: Counters };

export function getCountersName(): CountersName {
  return hasUpstash() ? "upstash" : hasSupabase() ? "postgres" : "memory";
}

/** Upstash Redis → Postgres counts over check logs → in-memory (demo, tests). One instance per server. */
export function getCounters(): Counters {
  if (g.__gatekeepCounters) return g.__gatekeepCounters;
  const name = getCountersName();
  g.__gatekeepCounters =
    name === "upstash"
      ? createUpstashCounters(env.upstashUrl, env.upstashToken)
      : name === "postgres"
        ? new PostgresCounters(getAdminClient())
        : new MemoryCounters();
  return g.__gatekeepCounters;
}
