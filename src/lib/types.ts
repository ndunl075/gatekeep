// Shared contracts. Every module (engine, store, API, dashboard) codes against these.
// Change them only in a PR of their own.

export type Decision = "allow" | "challenge" | "block";

export type PlanId = "free" | "pro" | "scale";

/** Body of POST /api/v1/check (also served at /check). */
export interface CheckInput {
  email: string;
  ip?: string;
  user_agent?: string;
  /** Optional stable browser id from the gatekeep.js snippet. */
  device_id?: string;
  /** Optional display name the user typed at signup. */
  name?: string;
}

export type SignalId =
  | "invalid_email"
  | "disposable_domain"
  | "no_mx"
  | "plus_alias"
  | "dot_alias"
  | "email_reuse"
  | "ip_velocity"
  | "device_velocity"
  | "signup_burst"
  | "gibberish_name"
  | "gibberish_email"
  | "bot_user_agent";

export interface Signal {
  id: SignalId;
  /** Risk points this signal adds to the 0-100 score. */
  points: number;
  /** Human readable, shown in the API reason and the dashboard. */
  detail: string;
}

export interface CheckResult {
  id: string;
  decision: Decision;
  /** 0 (clean) to 100 (certain abuse). */
  score: number;
  /** One-line summary of the strongest signals. */
  reason: string;
  signals: Signal[];
  normalized_email: string;
  latency_ms: number;
  /** Set when the project is over its monthly plan quota. The check still ran (fail open). */
  quota_exceeded?: boolean;
  /** Set when gatekeep itself failed; decision is then "allow" (fail open). */
  error?: string;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  /** Dollar value, in cents, of the free credits a new signup gets. Drives "est. credits saved". */
  credit_value_cents: number;
  /** score >= challenge_threshold → challenge */
  challenge_threshold: number;
  /** score >= block_threshold → block */
  block_threshold: number;
  plan: PlanId;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  /** First 12 chars of the key, e.g. "gk_live_ab12", safe to display. */
  prefix: string;
  /** sha256 hex of the full key. The plaintext is never stored. */
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CheckLog {
  id: string;
  project_id: string;
  created_at: string;
  email: string;
  normalized_email: string;
  email_domain: string;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  decision: Decision;
  score: number;
  reason: string;
  signals: Signal[];
  latency_ms: number;
}

export interface DailyStat {
  /** YYYY-MM-DD, UTC */
  date: string;
  allow: number;
  challenge: number;
  block: number;
}
