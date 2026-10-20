// Copied from the gatekeep API contract (src/lib/types.ts). The SDK must not import from the app.

export type Decision = "allow" | "challenge" | "block";

export interface CheckInput {
  email: string;
  ip?: string;
  user_agent?: string;
  /** Stable browser id from gatekeep.js. */
  device_id?: string;
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
  points: number;
  detail: string;
}

export interface CheckResult {
  id: string;
  decision: Decision;
  /** 0 (clean) to 100 (certain abuse). */
  score: number;
  reason: string;
  signals: Signal[];
  normalized_email: string;
  latency_ms: number;
  quota_exceeded?: boolean;
  /** Set when gatekeep failed or was unreachable; decision is then "allow" (fail open). */
  error?: string;
}

export interface Gatekeep {
  check(input: CheckInput): Promise<CheckResult>;
}
