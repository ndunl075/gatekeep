import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts reads process.env at import time, so each case stubs the environment and re-imports the module.
async function load() {
  vi.resetModules();
  (globalThis as { __gatekeepStore?: unknown }).__gatekeepStore = undefined;
  return (await import("./index")).getStore;
}

describe("getStore", () => {
  beforeEach(() => {
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GATEKEEP_DEMO"]) {
      vi.stubEnv(k, "");
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    (globalThis as { __gatekeepStore?: unknown }).__gatekeepStore = undefined;
  });

  it("is the seeded in-memory store in development with no Supabase", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getStore = await load();
    const store = getStore();
    expect(store.constructor.name).toBe("MemoryStore");
    expect(getStore()).toBe(store);
  });

  it("refuses to run in production without Supabase or GATEKEEP_DEMO=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getStore = await load();
    expect(() => getStore()).toThrow(/not configured/);
  });

  it("serves demo data in production when GATEKEEP_DEMO=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GATEKEEP_DEMO", "1");
    const getStore = await load();
    expect(getStore().constructor.name).toBe("MemoryStore");
  });

  it("is the SupabaseStore when Supabase is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const getStore = await load();
    expect(getStore().constructor.name).toBe("SupabaseStore");
  });
});
