import { getClientIp } from "./index";
import type { Gatekeep } from "./types";

const enc = new TextEncoder();

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Verify a Standard Webhooks signature (what Supabase Auth hooks send).
 * `secret` is the dashboard value `v1,whsec_<base64>`. Rejects timestamps more than `toleranceSec` off.
 */
export async function verifyStandardWebhook(
  secret: string,
  body: string,
  headers: Headers,
  opts: { toleranceSec?: number; now?: number } = {},
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;

  const tolerance = opts.toleranceSec ?? 300;
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > tolerance) return false;

  try {
    const rawSecret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
    const key = await crypto.subtle.importKey("raw", b64decode(rawSecret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = b64encode(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
    // Header holds space-separated "v1,<sig>" entries (several during secret rotation).
    return sigHeader.split(" ").some((part) => {
      const [version, sig] = part.split(",");
      return version === "v1" && sig !== undefined && timingSafeEqual(sig, expected);
    });
  } catch {
    return false;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SupabaseHookOptions {
  gatekeep: Gatekeep;
  /** The hook secret from the Supabase dashboard (`v1,whsec_...`). */
  hookSecret: string;
  /** Shown to blocked users. */
  blockMessage?: string;
  /** Called on a challenge decision (the hook cannot alter the user, so log or queue a follow-up here). */
  onChallenge?: (info: { email: string; score: number; reason: string }) => void | Promise<void>;
  /** Override the clock (tests). */
  now?: () => number;
}

interface BeforeUserCreatedPayload {
  metadata?: { ip_address?: string };
  user?: { email?: string; user_metadata?: { full_name?: string; name?: string } };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Handler for the Supabase Auth "Before User Created" HTTP hook.
 * Blocked signups get 400 `{ error: { http_code, message } }`; everything else gets 200 `{}`.
 * The hook cannot modify the user, so a `challenge` is allowed through (use `onChallenge` to follow up).
 * A bad signature gets 401. Any internal failure allows the signup (fail open).
 */
export function createSupabaseBeforeUserCreatedHandler(opts: SupabaseHookOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const body = await req.text();
    const ok = await verifyStandardWebhook(opts.hookSecret, body, req.headers, { now: opts.now?.() });
    if (!ok) return json(401, { error: { http_code: 401, message: "invalid signature" } });

    try {
      const payload = JSON.parse(body) as BeforeUserCreatedPayload;
      const email = payload.user?.email;
      if (!email) return json(200, {});
      const um = payload.user?.user_metadata;
      const result = await opts.gatekeep.check({
        email,
        ip: payload.metadata?.ip_address || getClientIp(req.headers),
        user_agent: req.headers.get("user-agent") ?? undefined,
        name: um?.full_name ?? um?.name,
      });
      if (result.decision === "block") {
        return json(400, {
          error: { http_code: 400, message: opts.blockMessage ?? "We couldn't create this account. Try a different email." },
        });
      }
      if (result.decision === "challenge") {
        await opts.onChallenge?.({ email, score: result.score, reason: result.reason });
      }
    } catch (e) {
      console.warn("[gatekeep] supabase hook failed open:", e instanceof Error ? e.message : e);
    }
    return json(200, {});
  };
}
