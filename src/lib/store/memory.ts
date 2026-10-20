import type { ApiKey, CheckLog, DailyStat, Project, SignalId } from "../types";
import type { BillingPatch, Counters, ListChecksOptions, ProjectPatch, Store } from "./types";

const DAY_MS = 86_400_000;
/** Longest window any check uses (email reuse: 30 days). Counters may forget older events. */
export const MAX_WINDOW_SEC = 31 * 86_400;

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Drops keys whose value is undefined so a partial patch never blanks a field. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function defaultProject(ownerId: string, name: string, id = newId()): Project {
  return {
    id,
    owner_id: ownerId,
    name,
    credit_value_cents: 50,
    challenge_threshold: 40,
    block_threshold: 70,
    plan: "free",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    created_at: new Date().toISOString(),
  };
}

export class MemoryStore implements Store {
  projects = new Map<string, Project>();
  keys = new Map<string, ApiKey>();
  checks: CheckLog[] = [];

  async getProject(id: string) {
    return this.projects.get(id) ?? null;
  }
  async listProjectsForOwner(ownerId: string) {
    return [...this.projects.values()].filter((p) => p.owner_id === ownerId);
  }
  async createProject(ownerId: string, name: string) {
    const p = defaultProject(ownerId, name);
    this.projects.set(p.id, p);
    return p;
  }
  async updateProject(id: string, patch: ProjectPatch) {
    const p = this.projects.get(id);
    if (!p) throw new Error("project not found");
    const next = { ...p, ...defined(patch) };
    this.projects.set(id, next);
    return next;
  }
  async setBilling(id: string, patch: BillingPatch) {
    const p = this.projects.get(id);
    if (!p) throw new Error("project not found");
    const next = { ...p, ...defined(patch) };
    this.projects.set(id, next);
    return next;
  }
  async getProjectByStripeCustomer(customerId: string) {
    return [...this.projects.values()].find((p) => p.stripe_customer_id === customerId) ?? null;
  }

  async findKeyByHash(hash: string) {
    return [...this.keys.values()].find((k) => k.key_hash === hash && !k.revoked_at) ?? null;
  }
  async listKeys(projectId: string) {
    return [...this.keys.values()]
      .filter((k) => k.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async insertKey(key: ApiKey) {
    // Same as the database: ids and key hashes are unique.
    if (this.keys.has(key.id) || [...this.keys.values()].some((k) => k.key_hash === key.key_hash)) {
      throw new Error("duplicate api key");
    }
    this.keys.set(key.id, key);
  }
  async revokeKey(projectId: string, keyId: string) {
    const k = this.keys.get(keyId);
    if (k && k.project_id === projectId && !k.revoked_at) this.keys.set(keyId, { ...k, revoked_at: new Date().toISOString() });
  }
  async touchKey(keyId: string) {
    const k = this.keys.get(keyId);
    if (k) this.keys.set(keyId, { ...k, last_used_at: new Date().toISOString() });
  }

  async insertCheck(log: CheckLog) {
    if (this.checks.some((c) => c.id === log.id)) throw new Error("duplicate check id");
    this.checks.push(log);
  }
  async listChecks(projectId: string, opts: ListChecksOptions = {}) {
    const q = opts.search?.trim().toLowerCase();
    return this.checks
      .filter(
        (c) =>
          c.project_id === projectId &&
          (!opts.before || c.created_at < opts.before) &&
          (!opts.decision || c.decision === opts.decision) &&
          (!q || c.email.toLowerCase().includes(q) || (c.ip ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, opts.limit ?? 50);
  }
  async getCheck(projectId: string, checkId: string) {
    return this.checks.find((c) => c.project_id === projectId && c.id === checkId) ?? null;
  }
  async dailyStats(projectId: string, days: number): Promise<DailyStat[]> {
    const out = new Map<string, DailyStat>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = utcDate(new Date(today.getTime() - i * DAY_MS));
      out.set(date, { date, allow: 0, challenge: 0, block: 0 });
    }
    for (const c of this.checks) {
      if (c.project_id !== projectId) continue;
      const s = out.get(c.created_at.slice(0, 10));
      if (s) s[c.decision]++;
    }
    return [...out.values()];
  }
  async monthlyUsage(projectId: string) {
    const month = new Date().toISOString().slice(0, 7);
    return this.checks.filter((c) => c.project_id === projectId && c.created_at.startsWith(month)).length;
  }
  async topSignals(projectId: string, days: number) {
    const since = utcDate(new Date(Date.now() - (days - 1) * DAY_MS));
    const counts = new Map<SignalId, number>();
    for (const c of this.checks) {
      if (c.project_id !== projectId || c.created_at.slice(0, 10) < since) continue;
      for (const s of c.signals) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  }
}

export class MemoryCounters implements Counters {
  private events = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  private list(key: string): number[] {
    // Keep up to MAX_WINDOW_SEC of events per key; callers may query different windows on one key.
    const cutoff = this.now() - MAX_WINDOW_SEC * 1000;
    const list = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    this.events.set(key, list);
    return list;
  }
  async hit(key: string, windowSec: number) {
    this.list(key).push(this.now());
    return this.count(key, windowSec);
  }
  async count(key: string, windowSec: number) {
    const cutoff = this.now() - windowSec * 1000;
    return this.list(key).filter((t) => t > cutoff).length;
  }
}
