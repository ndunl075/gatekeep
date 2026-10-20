import { hasSupabase, isDemoMode } from "../env";
import { createDemoStore } from "../demo";
import { getAdminClient } from "../supabase/admin";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";

export type { Store, Counters } from "./types";

// One store per server instance. With Supabase configured it is the SupabaseStore (service role, scoped by
// project in every query). Otherwise, in demo mode, it is an in-memory store seeded with demo data so the API
// and dashboard work with zero configuration (data resets on cold start).
const g = globalThis as unknown as { __gatekeepStore?: Store };

export function getStore(): Store {
  if (g.__gatekeepStore) return g.__gatekeepStore;
  let store: Store;
  if (hasSupabase()) {
    store = new SupabaseStore(getAdminClient());
  } else if (isDemoMode()) {
    store = createDemoStore();
  } else {
    // isMisconfigured(): production without Supabase and without GATEKEEP_DEMO=1.
    throw new Error("gatekeep is not configured: set the Supabase env vars, or GATEKEEP_DEMO=1 for a demo deploy");
  }
  g.__gatekeepStore = store;
  return store;
}
