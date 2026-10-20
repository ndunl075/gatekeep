import { createBrowserClient } from "@supabase/ssr";
import { env } from "../env";

/** Browser client (anon key). Used by the login page; it can only do what RLS allows a signed-in user. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
