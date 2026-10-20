import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "../env";

// Service-role client: bypasses RLS. Server only (the import above fails the build if a client component pulls
// this in) and every query made with it must be scoped by project_id / owner_id by the caller.
const g = globalThis as unknown as { __gatekeepAdmin?: SupabaseClient };

export function getAdminClient(): SupabaseClient {
  if (!hasSupabase()) throw new Error("Supabase is not configured");
  g.__gatekeepAdmin ??= createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return g.__gatekeepAdmin;
}
