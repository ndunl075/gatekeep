import "server-only";
import { isDemoMode } from "./env";
import { DEMO_OWNER_ID, DEMO_PROJECT_ID } from "./demo";
import { getStore } from "./store";
import type { Project } from "./types";

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in dashboard user, or null. In demo mode there is always a demo user. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (isDemoMode()) return { id: DEMO_OWNER_ID, email: "demo@gatekeep.dev" };
  // Replaced by Supabase auth in the data-layer PR.
  throw new Error("Supabase auth not implemented yet");
}

/**
 * The project the dashboard is showing. Dashboard pages and server actions call this and
 * never take a project id from the client.
 */
export async function getCurrentProject(): Promise<Project> {
  if (isDemoMode()) {
    const p = await getStore().getProject(DEMO_PROJECT_ID);
    if (!p) throw new Error("demo project missing");
    return p;
  }
  throw new Error("Supabase auth not implemented yet");
}
