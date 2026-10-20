import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Cookie-based client acting as the signed-in user (anon key + their session). Use it for
 * auth only (getUser, sign out, code exchange); data goes through the store.
 * Works in server components, server actions and route handlers.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a server component, which cannot set cookies. The middleware refreshes the session.
        }
      },
    },
  });
}
