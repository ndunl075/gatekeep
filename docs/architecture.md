# Architecture

Next.js 15 (App Router, TypeScript, Tailwind v4) on Vercel. Supabase (Postgres + Auth) for projects, keys and
check logs. Upstash Redis for velocity counters. Stripe for billing. **Every integration is optional**: with no
env vars the app runs in demo mode (in-memory store seeded by `src/lib/demo.ts`, no login, no billing).

## Request flow: `POST /api/v1/check` (also `POST /check`)

```
Authorization: Bearer gk_live_...
{ "email": "n.ico+7@gmail.com", "ip": "1.2.3.4", "user_agent": "...", "device_id": "optional", "name": "optional" }
→ 200 { "id", "decision": "allow"|"challenge"|"block", "score": 0-100, "reason", "signals": [...],
        "normalized_email", "latency_ms" }
```

1. `readKeyFromHeaders` → shape check (`gk_live_` + 40 alphanumerics, or the demo key) → `hashKey` →
   `store.findKeyByHash` → project. 401 if missing, malformed, unknown or revoked; the first two never touch the
   store, and unknown keys are remembered for 60s (bounded) so guessing cannot become database load. Non-JSON body →
   400 (before this step); body over 16 KB → 413 (rejected from `Content-Length`, or while streaming).
   Everything from the key lookup to "project, limit and usage known" has a 1s budget; if the store hangs or throws,
   the request fails open (step 6).
2. Per-key rate limit: 600 requests/minute via counters (`gk:rl:{keyId}`) → 429 + `Retry-After`. With **Upstash** the
   limit is global. With **Postgres counters** (no Upstash) it is per server instance, because the `checks` table
   cannot hold arbitrary keys: approximate on serverless, but it never blocks a signup. Upstash is recommended when
   a global limit matters. A failing counters backend also falls back to the per-instance limiter. Then the body is
   validated with zod → 400 `{error:"invalid_request", message}`; unknown fields are ignored.
3. Quota: `store.monthlyUsage(project) >= PLANS[plan].checksPerMonth` → still run the check but add
   `"quota_exceeded": true` to the response. The usage count is cached per project for 30s; a count that takes over 300ms counts as "not exceeded". **Fail open**:
   gatekeep must never break a customer's signup.
4. `runChecks(input, ctx)` (engine) → score, signals, decision. `degraded` markers are logged (at most once a
   minute per marker).
5. `store.insertCheck(log)` and `store.touchKey` run in `after()` so the response is not blocked (bounded to 5s; `touchKey` at
   most once a minute per key). Respond with `Cache-Control: no-store` and `X-Gatekeep-Latency`. Target p50 < 150ms; MX
   lookups use a dedicated resolver with a 1.5s timeout (one try) and are cached (1h; 5 min when unknown). A `no_mx` answer is only trusted while a DNS
   canary (gmail.com) resolves, so a broken resolver cannot flag every domain.
6. Errors inside gatekeep (including the store being down) return `decision: "allow"` with `"error"` set, never a 5xx.

Counters: Upstash Redis (sorted set per key) → Postgres counts over `checks` (when Supabase is set but Upstash is
not) → in-memory. `GET /api/v1/health` reports which are active (503 when production is unconfigured).
`POST /check` is a rewrite to `/api/v1/check`. The dashboard Integrate page has a playground that calls
`runCheckForProject` (dry run or recorded) for the signed-in user's project.

## Engine contract (`src/lib/engine/index.ts`)

```ts
export interface EngineContext {
  projectId: string;
  counters: Counters;                                  // src/lib/store/types.ts
  resolveMx: (domain: string) => Promise<boolean | null>; // null = unknown (timeout/error) → no signal
  thresholds: { challenge: number; block: number };
  /** True when the caller only wants to score, not record (playground "dry run"). */
  dryRun?: boolean;
}
export interface EngineResult { decision: Decision; score: number; reason: string; signals: Signal[];
  normalized_email: string; email_domain: string }
export async function runChecks(input: CheckInput, ctx: EngineContext): Promise<EngineResult>
export function normalizeEmail(email: string): { normalized: string; domain: string; local: string;
  plusAlias: boolean; dotAlias: boolean } | null   // null = invalid syntax
```

Scoring (points add up, capped at 100; decision from project thresholds, default challenge ≥ 40, block ≥ 70):

| Signal | Points | Rule |
|---|---|---|
| invalid_email | 100 | fails syntax |
| disposable_domain | 80 | domain (or parent domain) on the bundled disposable list |
| no_mx | 70 | domain has no MX (and no A fallback) records |
| ip_velocity | 45 / 60 | ≥3 / ≥6 checks from this IP in 24h, this one included |
| device_velocity | 45 / 60 | ≥3 / ≥6 checks from this device_id in 24h |
| email_reuse | 35 | normalized email already checked in this project in the last 30 days |
| bot_user_agent | 30 | user agent missing, or curl / python / headless / bot |
| signup_burst | 25 | project checks in last 10 min ≥ 20 and ≥ 5x the trailing 24h average per 10 min |
| gibberish_email | 25 | local part looks machine generated (consonant runs, digit soup, low bigram score) |
| gibberish_name | 20 | `name` looks like keyboard mash |
| plus_alias | 10 | `+tag` present (provider that supports it) |
| dot_alias | 10 | gmail/googlemail local part contains dots |

Normalization: lowercase; googlemail.com → gmail.com; gmail: strip dots and `+tag`; other plus-addressing
providers (outlook, hotmail, live, icloud, me, proton, fastmail, yahoo uses `-`): strip `+tag`.

Counter keys (all namespaced `gk:{projectId}:`): `ip:{ip}`, `dev:{device_id}`, `em:{normalized}`, `burst`.
Engine calls `counters.hit` (or `count` when dryRun).

## Modules and owners

| Path | Owner PR |
|---|---|
| `src/lib/types.ts`, `src/lib/store/types.ts`, `src/lib/plans.ts`, `src/lib/env.ts` | foundation (contracts; change only in their own PR) |
| `src/lib/engine/**` | engine |
| `supabase/**`, `src/lib/store/supabase.ts`, `src/lib/store/index.ts`, `src/lib/session.ts`, `src/lib/supabase/**`, `src/middleware.ts`, `src/app/login/**`, `src/app/auth/**` | data layer |
| `src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`, `checks/**`, `keys/**`, `settings/**`, `src/app/dashboard/actions.ts`, `src/components/dashboard/**` | dashboard |
| `src/app/page.tsx`, `src/app/pricing/**`, `src/app/docs/**`, `src/components/marketing/**`, `public/og*` | landing |
| `sdk/**`, `public/gatekeep.js`, `src/app/dashboard/integrate/**` | sdk |
| `src/app/api/v1/**`, `src/lib/check-service.ts`, `src/lib/counters/**`, `src/lib/mx.ts`, `next.config.ts` | api |
| `src/lib/billing/**`, `src/app/api/stripe/**`, `src/app/dashboard/billing/**` | billing |

Dashboard pages render **only their content** wrapped in `<AppContent>`; `src/app/dashboard/layout.tsx` renders
the `AppWindow` chrome. Pages get data server-side via `getCurrentProject()` + `getStore()` and never accept a
project id from the client.

## Est. credits saved

`blocked_count × project.credit_value_cents`. Only blocks count (challenged users may be real). The dashboard says
so in a tooltip/footnote. This is the renewal number; keep it honest.
