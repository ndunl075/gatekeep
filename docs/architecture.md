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

1. `readKeyFromHeaders` → `hashKey` → `store.findKeyByHash` → project. 401 if missing/invalid.
2. Quota: `store.monthlyUsage(project) >= PLANS[plan].checksPerMonth` → still run the check but add
   `"quota_exceeded": true` to the response. **Fail open**: gatekeep must never break a customer's signup.
3. `runChecks(input, ctx)` (engine) → score, signals, decision.
4. `store.insertCheck(log)`, `store.touchKey`. Respond. Target p50 < 150ms; MX lookups have a 1.5s timeout and
   are cached.
5. Errors inside gatekeep return `decision: "allow"` with `"error"` set, never a 5xx for engine failures.

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
| bot_user_agent | 30 | user agent sent but empty, or curl / python / headless / bot (an omitted `user_agent` field is not a signal: server-side integrations often cannot send one) |
| signup_burst | 25 | project checks in last 10 min ≥ 20 and ≥ 5x the trailing 24h average per 10 min |
| gibberish_email | 25 | local part looks machine generated (consonant runs, digit soup, low bigram score) |
| gibberish_name | 20 | `name` looks like keyboard mash |
| plus_alias | 10 | `+tag` present (provider that supports it) |
| dot_alias | 5 | gmail/googlemail local part contains dots (weak on its own: many real addresses have dots) |

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
