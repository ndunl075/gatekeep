import type { ApiKey, CheckLog, DailyStat, Decision, PlanId, Project, SignalId } from "../types";

export interface ListChecksOptions {
  limit?: number;
  /** ISO timestamp; return checks strictly older than this (for paging). */
  before?: string;
  decision?: Decision;
  /** Case-insensitive substring match on email or ip. */
  search?: string;
}

export type ProjectPatch = Partial<
  Pick<Project, "name" | "credit_value_cents" | "challenge_threshold" | "block_threshold">
>;

export interface BillingPatch {
  plan: PlanId;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

/** Persistence for projects, API keys and check logs. Implemented by memory and Supabase. */
export interface Store {
  // projects
  getProject(projectId: string): Promise<Project | null>;
  listProjectsForOwner(ownerId: string): Promise<Project[]>;
  createProject(ownerId: string, name: string): Promise<Project>;
  updateProject(projectId: string, patch: ProjectPatch): Promise<Project>;
  setBilling(projectId: string, patch: BillingPatch): Promise<Project>;
  getProjectByStripeCustomer(customerId: string): Promise<Project | null>;
  /** The owner's oldest project, creating one named `name` if they have none. Atomic per owner. */
  ensureProject?(ownerId: string, name: string): Promise<Project>;

  // api keys
  /** Looks up an active (not revoked) key by sha256 hash. */
  findKeyByHash(keyHash: string): Promise<ApiKey | null>;
  listKeys(projectId: string): Promise<ApiKey[]>;
  /** Stores a key row. Callers generate the plaintext + hash via lib/keys.ts. */
  insertKey(key: ApiKey): Promise<void>;
  revokeKey(projectId: string, keyId: string): Promise<void>;
  touchKey(keyId: string): Promise<void>;

  // check logs
  insertCheck(log: CheckLog): Promise<void>;
  listChecks(projectId: string, opts?: ListChecksOptions): Promise<CheckLog[]>;
  getCheck(projectId: string, checkId: string): Promise<CheckLog | null>;
  /** Per-day decision counts for the last `days` days (UTC), oldest first, zero-filled. */
  dailyStats(projectId: string, days: number): Promise<DailyStat[]>;
  /** Number of checks since the start of the current UTC calendar month. */
  monthlyUsage(projectId: string): Promise<number>;
  /** How often each signal fired in the last `days` days (UTC), most frequent first. */
  topSignals(projectId: string, days: number): Promise<{ id: SignalId; count: number }[]>;
}

/**
 * Sliding-window event counters used by velocity / burst / reuse checks.
 * Implemented by Upstash Redis, Postgres (counts over check logs) and memory.
 * Windows up to 31 days must be supported (MAX_WINDOW_SEC in memory.ts).
 */
export interface Counters {
  /** Records one event for `key` now and returns the count inside the last `windowSec`, including this one. */
  hit(key: string, windowSec: number): Promise<number>;
  /** Count inside the last `windowSec` without recording. */
  count(key: string, windowSec: number): Promise<number>;
}
