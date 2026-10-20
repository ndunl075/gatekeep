import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { hasSupabase, isDemoMode } from "./env";
import { DEMO_OWNER_ID, DEMO_PROJECT_ID } from "./demo";
import { getStore } from "./store";
import { createSupabaseServerClient } from "./supabase/server";
import type { Project } from "./types";

export interface SessionUser {
  id: string;
  email: string;
}

function assertConfigured() {
  if (!hasSupabase()) {
    throw new Error("gatekeep is not configured: set the Supabase env vars, or GATEKEEP_DEMO=1 for a demo deploy");
  }
}

// cache(): one lookup per request, however many layouts / pages / actions ask.

/** The signed-in dashboard user, or null. In demo mode there is always a demo user. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (isDemoMode()) return { id: DEMO_OWNER_ID, email: "demo@gatekeep.dev" };
  assertConfigured();
  const supabase = await createSupabaseServerClient();
  // getUser() verifies the token with the auth server; getSession() would only trust the cookie.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

/**
 * The project the dashboard is showing. Dashboard pages and server actions call this and
 * never take a project id from the client. Signed-out callers are sent to /login.
 */
export const getCurrentProject = cache(async (): Promise<Project> => {
  if (isDemoMode()) {
    const p = await getStore().getProject(DEMO_PROJECT_ID);
    if (!p) throw new Error("demo project missing");
    return p;
  }
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const store = getStore();
  const existing = await store.listProjectsForOwner(user.id);
  if (existing.length > 0) return existing[0];

  // First visit: give the user a project. (A first API key is created by the dashboard, not here.)
  const created = await store.createProject(user.id, "My app");
  // Two first requests can race and both create one. Both then agree on the oldest.
  const all = await store.listProjectsForOwner(user.id);
  return all[0] ?? created;
});
