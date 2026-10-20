import { isDemoMode } from "../env";
import { createDemoStore } from "../demo";
import type { Store } from "./types";

export type { Store, Counters } from "./types";

// One store per server instance. In demo mode it is an in-memory store seeded with demo data,
// so the API and dashboard work with zero configuration (data resets on cold start).
const g = globalThis as unknown as { __gatekeepStore?: Store };

export function getStore(): Store {
  if (!g.__gatekeepStore) {
    if (isDemoMode()) {
      g.__gatekeepStore = createDemoStore();
    } else {
      // Replaced by the Supabase store in the data-layer PR.
      throw new Error("Supabase store not implemented yet");
    }
  }
  return g.__gatekeepStore;
}
