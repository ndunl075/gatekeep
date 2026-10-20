import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiKey, CheckLog, DailyStat, Decision, PlanId, Project, Signal, SignalId } from "../types";
import type { BillingPatch, ListChecksOptions, ProjectPatch, Store } from "./types";

// Every method is scoped by project_id (or owner_id / key hash, where that is the lookup). The client is the
// service-role client, which bypasses RLS, so the scoping here is the access control.

type Row = Record<string, unknown>;

/** PostgREST returns timestamptz as "2026-01-02T03:04:05.123456+00:00"; the app speaks JS ISO strings. */
const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

const PROJECT_COLS =
  "id, owner_id, name, credit_value_cents, challenge_threshold, block_threshold, plan, stripe_customer_id, stripe_subscription_id, created_at";
const KEY_COLS = "id, project_id, name, prefix, key_hash, created_at, last_used_at, revoked_at";
const CHECK_COLS =
  "id, project_id, created_at, email, normalized_email, email_domain, ip, user_agent, device_id, decision, score, reason, signals, latency_ms";

export function toProject(r: Row): Project {
  return {
    id: r.id as string,
    owner_id: r.owner_id as string,
    name: r.name as string,
    credit_value_cents: r.credit_value_cents as number,
    challenge_threshold: r.challenge_threshold as number,
    block_threshold: r.block_threshold as number,
    plan: r.plan as PlanId,
    stripe_customer_id: (r.stripe_customer_id as string | null) ?? null,
    stripe_subscription_id: (r.stripe_subscription_id as string | null) ?? null,
    created_at: iso(r.created_at),
  };
}

export function toKey(r: Row): ApiKey {
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    name: r.name as string,
    prefix: r.prefix as string,
    key_hash: r.key_hash as string,
    created_at: iso(r.created_at),
    last_used_at: isoOrNull(r.last_used_at),
    revoked_at: isoOrNull(r.revoked_at),
  };
}

export function toCheck(r: Row): CheckLog {
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    created_at: iso(r.created_at),
    email: r.email as string,
    normalized_email: r.normalized_email as string,
    email_domain: r.email_domain as string,
    ip: (r.ip as string | null) ?? null,
    user_agent: (r.user_agent as string | null) ?? null,
    device_id: (r.device_id as string | null) ?? null,
    decision: r.decision as Decision,
    score: r.score as number,
    reason: (r.reason as string | null) ?? "",
    signals: Array.isArray(r.signals) ? (r.signals as Signal[]) : [],
    latency_ms: r.latency_ms as number,
  };
}

/** Drops undefined values so a partial patch never blanks a column (null still clears one). */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Builds the value of a PostgREST `or=(...)` filter that matches `term` as a literal substring (case-insensitive)
 * of each column. Escapes LIKE wildcards, and quotes the value so commas, parentheses and dots in user input
 * cannot change the filter grammar.
 */
export function substringOrFilter(columns: string[], term: string): string {
  const like = term
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    // PostgREST treats "*" in like/ilike values as "%". Match it as any single character instead of a wildcard run.
    .replace(/\*/g, "_");
  const quoted = `"%${like.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
  return columns.map((c) => `${c}.ilike.${quoted}`).join(",");
}

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  private fail(op: string, error: { message: string }): never {
    throw new Error(`supabase ${op}: ${error.message}`);
  }

  // projects ---------------------------------------------------------------------------------------------

  async getProject(projectId: string) {
    const { data, error } = await this.db.from("projects").select(PROJECT_COLS).eq("id", projectId).maybeSingle();
    if (error) this.fail("getProject", error);
    return data ? toProject(data) : null;
  }

  async listProjectsForOwner(ownerId: string) {
    const { data, error } = await this.db
      .from("projects")
      .select(PROJECT_COLS)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) this.fail("listProjectsForOwner", error);
    return (data ?? []).map(toProject);
  }

  async createProject(ownerId: string, name: string) {
    const { data, error } = await this.db
      .from("projects")
      .insert({ owner_id: ownerId, name })
      .select(PROJECT_COLS)
      .single();
    if (error) this.fail("createProject", error);
    return toProject(data);
  }

  private async patchProject(op: string, projectId: string, patch: object) {
    const values = defined(patch);
    if (Object.keys(values).length === 0) {
      const p = await this.getProject(projectId);
      if (!p) throw new Error("project not found");
      return p;
    }
    const { data, error } = await this.db
      .from("projects")
      .update(values)
      .eq("id", projectId)
      .select(PROJECT_COLS)
      .maybeSingle();
    if (error) this.fail(op, error);
    if (!data) throw new Error("project not found");
    return toProject(data);
  }

  updateProject(projectId: string, patch: ProjectPatch) {
    return this.patchProject("updateProject", projectId, {
      name: patch.name,
      credit_value_cents: patch.credit_value_cents,
      challenge_threshold: patch.challenge_threshold,
      block_threshold: patch.block_threshold,
    });
  }

  setBilling(projectId: string, patch: BillingPatch) {
    return this.patchProject("setBilling", projectId, {
      plan: patch.plan,
      stripe_customer_id: patch.stripe_customer_id,
      stripe_subscription_id: patch.stripe_subscription_id,
    });
  }

  async getProjectByStripeCustomer(customerId: string) {
    const { data, error } = await this.db
      .from("projects")
      .select(PROJECT_COLS)
      .eq("stripe_customer_id", customerId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) this.fail("getProjectByStripeCustomer", error);
    return data ? toProject(data) : null;
  }

  // api keys ---------------------------------------------------------------------------------------------

  async findKeyByHash(keyHash: string) {
    const { data, error } = await this.db
      .from("api_keys")
      .select(KEY_COLS)
      .eq("key_hash", keyHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) this.fail("findKeyByHash", error);
    return data ? toKey(data) : null;
  }

  async listKeys(projectId: string) {
    const { data, error } = await this.db
      .from("api_keys")
      .select(KEY_COLS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) this.fail("listKeys", error);
    return (data ?? []).map(toKey);
  }

  async insertKey(key: ApiKey) {
    const { error } = await this.db.from("api_keys").insert({
      id: key.id,
      project_id: key.project_id,
      name: key.name,
      prefix: key.prefix,
      key_hash: key.key_hash,
      created_at: key.created_at,
      last_used_at: key.last_used_at,
      revoked_at: key.revoked_at,
    });
    if (error) this.fail("insertKey", error);
  }

  async revokeKey(projectId: string, keyId: string) {
    const { error } = await this.db
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("project_id", projectId)
      .is("revoked_at", null);
    if (error) this.fail("revokeKey", error);
  }

  async touchKey(keyId: string) {
    const { error } = await this.db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
    if (error) this.fail("touchKey", error);
  }

  // check logs -------------------------------------------------------------------------------------------

  async insertCheck(log: CheckLog) {
    const { error } = await this.db.from("checks").insert({
      id: log.id,
      project_id: log.project_id,
      created_at: log.created_at,
      email: log.email,
      normalized_email: log.normalized_email,
      email_domain: log.email_domain,
      ip: log.ip,
      user_agent: log.user_agent,
      device_id: log.device_id,
      decision: log.decision,
      score: log.score,
      reason: log.reason,
      signals: log.signals,
      latency_ms: log.latency_ms,
    });
    if (error) this.fail("insertCheck", error);
  }

  async listChecks(projectId: string, opts: ListChecksOptions = {}) {
    let q = this.db.from("checks").select(CHECK_COLS).eq("project_id", projectId);
    if (opts.before) q = q.lt("created_at", opts.before);
    if (opts.decision) q = q.eq("decision", opts.decision);
    const term = opts.search?.trim();
    if (term) q = q.or(substringOrFilter(["email", "ip"], term));
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 1000));
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) this.fail("listChecks", error);
    return (data ?? []).map(toCheck);
  }

  async getCheck(projectId: string, checkId: string) {
    const { data, error } = await this.db
      .from("checks")
      .select(CHECK_COLS)
      .eq("project_id", projectId)
      .eq("id", checkId)
      .maybeSingle();
    if (error) this.fail("getCheck", error);
    return data ? toCheck(data) : null;
  }

  async dailyStats(projectId: string, days: number): Promise<DailyStat[]> {
    const { data, error } = await this.db.rpc("gatekeep_daily_stats", { p_project_id: projectId, p_days: days });
    if (error) this.fail("dailyStats", error);
    return (data as Row[]).map((r) => ({
      date: String(r.day).slice(0, 10),
      allow: Number(r.allow),
      challenge: Number(r.challenge),
      block: Number(r.block),
    }));
  }

  async monthlyUsage(projectId: string) {
    const { data, error } = await this.db.rpc("gatekeep_monthly_usage", { p_project_id: projectId });
    if (error) this.fail("monthlyUsage", error);
    return Number(data ?? 0);
  }

  async topSignals(projectId: string, days: number) {
    const { data, error } = await this.db.rpc("gatekeep_top_signals", { p_project_id: projectId, p_days: days });
    if (error) this.fail("topSignals", error);
    return (data as Row[]).map((r) => ({ id: r.signal_id as SignalId, count: Number(r.n) }));
  }
}
