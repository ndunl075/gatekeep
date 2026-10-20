import { resolve4, resolve6, resolveMx as dnsResolveMx } from "node:dns/promises";

const TIMEOUT_MS = 1500;
const TTL_KNOWN_MS = 60 * 60_000;
const TTL_UNKNOWN_MS = 5 * 60_000;
const MAX_ENTRIES = 5000;
/** A domain that certainly has mail servers, used to tell "no such domain" from "this resolver answers NXDOMAIN to everything". */
const CANARY_DOMAIN = "gmail.com";
const CANARY_OK_MS = 10 * 60_000;
const CANARY_FAIL_MS = 60_000;

interface Entry {
  value: boolean | null;
  expires: number;
}

// Insertion ordered, so the first key is always the oldest entry.
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<boolean | null>>();
let canary: { ok: boolean; expires: number } | null = null;
let canaryInflight: Promise<boolean> | null = null;

/** Test hook. */
export function clearMxCache(): void {
  cache.clear();
  inflight.clear();
  canary = null;
  canaryInflight = null;
}

/** ENODATA / ENOTFOUND mean the DNS answer was "no such records", not "lookup failed". */
function isNoRecords(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND";
}

/** Resolves true (has records), false (definitely none) or rejects with the underlying DNS error. */
async function lookup(domain: string): Promise<boolean> {
  try {
    const records = await dnsResolveMx(domain);
    if (records.length > 0) {
      // RFC 7505 "null MX": a single "." exchange says the domain accepts no mail at all.
      return records.some((r) => r.exchange.replace(/\.$/, "") !== "");
    }
  } catch (err) {
    if (!isNoRecords(err)) throw err;
  }
  // No MX: RFC 5321 treats the domain's own A / AAAA as an implicit MX.
  const results = await Promise.allSettled([resolve4(domain), resolve6(domain)]);
  if (results.some((r) => r.status === "fulfilled" && r.value.length > 0)) return true;
  // Unknown if either family failed for a reason other than "no records".
  const failed = results.find((r) => r.status === "rejected" && !isNoRecords(r.reason));
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return false;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mx lookup timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Is DNS answering sanely? Egress-filtered or misconfigured environments answer ENOTFOUND for every name, which
 * would otherwise score every legitimate signup as "no mail server". Checked only when a lookup says `false`.
 */
async function dnsHealthy(): Promise<boolean> {
  if (canary && canary.expires > Date.now()) return canary.ok;
  canaryInflight ??= withTimeout(lookup(CANARY_DOMAIN), TIMEOUT_MS)
    .then((v) => v === true)
    .catch(() => false)
    .then((ok) => {
      canary = { ok, expires: Date.now() + (ok ? CANARY_OK_MS : CANARY_FAIL_MS) };
      return ok;
    })
    .finally(() => {
      canaryInflight = null;
    });
  return canaryInflight;
}

function remember(domain: string, value: boolean | null): void {
  cache.delete(domain);
  cache.set(domain, { value, expires: Date.now() + (value === null ? TTL_UNKNOWN_MS : TTL_KNOWN_MS) });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Can this domain receive mail? true = MX (or implicit-MX A/AAAA) exists, false = definitely not,
 * null = unknown (timeout or resolver failure), which the engine treats as "no signal". Never throws.
 */
export async function resolveMx(rawDomain: string): Promise<boolean | null> {
  try {
    const domain = rawDomain.trim().toLowerCase().replace(/\.$/, "");
    if (!domain) return null;

    const hit = cache.get(domain);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (hit) cache.delete(domain);

    // Concurrent signups from one domain share a single lookup.
    let pending = inflight.get(domain);
    if (!pending) {
      pending = withTimeout(lookup(domain), TIMEOUT_MS)
        .catch(() => null)
        .then(async (value) => (value === false && !(await dnsHealthy()) ? null : value))
        .then((value) => {
          remember(domain, value);
          return value;
        })
        .finally(() => inflight.delete(domain));
      inflight.set(domain, pending);
    }
    return await pending;
  } catch {
    return null;
  }
}
