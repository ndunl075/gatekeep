import type { CheckResult, Gatekeep } from "./types";

export type { CheckInput, CheckResult, Decision, Gatekeep, Signal, SignalId } from "./types";

export interface GatekeepOptions {
  apiKey: string;
  /** Default https://gatekeep.dev */
  baseUrl?: string;
  /** Per-request timeout. Default 1500 ms. */
  timeoutMs?: number;
  /** Custom fetch (tests, edge runtimes). Defaults to global fetch. */
  fetch?: typeof fetch;
}

function failOpen(error: string, started: number, email: string): CheckResult {
  return {
    id: "",
    decision: "allow",
    score: 0,
    reason: "gatekeep unavailable",
    signals: [],
    normalized_email: email.trim().toLowerCase(),
    latency_ms: Date.now() - started,
    error,
  };
}

/**
 * Create a client. `check()` never throws: on timeout, network error, 4xx/5xx or bad JSON it resolves
 * an `allow` result with `error` set, so gatekeep can never break a signup.
 */
export function createGatekeep(opts: GatekeepOptions): Gatekeep {
  const baseUrl = (opts.baseUrl ?? "https://gatekeep.dev").replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 1500;
  let warned = false;

  const warnOnce = (msg: string) => {
    if (warned) return;
    warned = true;
    console.warn(`[gatekeep] ${msg}`);
  };

  return {
    async check(input) {
      const started = Date.now();
      const email = typeof input?.email === "string" ? input.email : "";
      const doFetch = opts.fetch ?? globalThis.fetch;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });
        const request = (async () => {
          const res = await doFetch(`${baseUrl}/api/v1/check`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
            body: JSON.stringify(input),
            signal: controller.signal,
          });
          if (res.status === 401 || res.status === 400) {
            warnOnce(`check rejected with HTTP ${res.status} (${res.status === 401 ? "invalid API key" : "bad request"}); failing open`);
            return failOpen(`http_${res.status}`, started, email);
          }
          if (!res.ok) return failOpen(`http_${res.status}`, started, email);
          const data = (await res.json()) as CheckResult;
          if (!data || typeof data.decision !== "string" || !["allow", "challenge", "block"].includes(data.decision)) {
            return failOpen("invalid_response", started, email);
          }
          return data;
        })();
        return await Promise.race([request, timeout]);
      } catch (e) {
        return failOpen(e instanceof Error ? e.message : "network_error", started, email);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const v = key ? bag[key] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Client IP from proxy headers: first hop of x-forwarded-for, then x-real-ip, then cf-connecting-ip. */
export function getClientIp(headers: HeaderBag): string | undefined {
  const xff = readHeader(headers, "x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return readHeader(headers, "x-real-ip")?.trim() || readHeader(headers, "cf-connecting-ip")?.trim() || undefined;
}
