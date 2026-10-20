# gatekeep

One API call that stops bots and throwaway accounts from farming free credits on your AI app's signup.

AI apps give free credits on signup, so people make 20 throwaway accounts (`n.ico+1@gmail.com`, mailinator,
temp-mail) and burn the founder's OpenAI / Anthropic bill. gatekeep checks each signup and answers **allow**,
**challenge** (make them verify a phone or card) or **block**, with a score and the reason.

```bash
curl -X POST https://<your-deployment>/check \
  -H "Authorization: Bearer gk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"n.ico+7@gmail.com","ip":"185.220.101.7","user_agent":"Mozilla/5.0 ..."}'
# → {"decision":"challenge","score":50,"reason":"nico@gmail.com already signed up 4 times; ...","signals":[...]}
```

## What's in the box

| Area | Where |
|---|---|
| `POST /api/v1/check` (also `/check`): validation, key auth, per-key rate limit, plan quota, fail open | `src/app/api/v1/check`, `src/lib/check-service.ts` |
| Scoring engine: ~98k disposable domains, Gmail dot/plus normalizing, MX lookup, same IP / device 3+ in 24h, signup bursts, gibberish emails and names, bot user agents | `src/lib/engine` |
| Counters: Upstash Redis sliding windows, Postgres fallback, memory in demo | `src/lib/counters` |
| Dashboard: overview (checked, blocked, challenged, est. credits saved), checks log + detail, API keys, settings, billing, integrate + live playground | `src/app/dashboard` |
| Supabase: schema + RLS migration, store, magic-link auth | `supabase/`, `src/lib/store`, `src/lib/supabase` |
| Stripe: checkout, customer portal, webhook that syncs from Stripe | `src/lib/billing`, `src/app/api/stripe` |
| Drop-in SDK for Clerk, Supabase Auth hooks, NextAuth, plus a device-id browser snippet | `sdk/`, `public/gatekeep.js` |
| Marketing site, pricing, API docs, integration guides | `src/app/page.tsx`, `/pricing`, `/docs` |

Pricing: Free 500 checks/mo, Pro $29/mo for 10k, Scale $99/mo for 100k (`src/lib/plans.ts`).

## Develop

```bash
npm install
npm run dev        # http://localhost:3000 in demo mode: seeded data, no login, no billing
npm run check      # lint + typecheck + tests
npm run build
```

Demo key for local calls: `gk_live_demo_key_for_the_playground_only`. CI (GitHub Actions) runs lint, typecheck,
tests and build on every PR.

## Go live

`docs/deploy.md` (Vercel + Supabase + Upstash + Stripe, about 15 minutes). Every variable is listed in
`.env.example`; with none set the app runs in demo mode.

## Docs

- `docs/architecture.md`: request flow, scoring table, module owners
- `docs/design.md`: the UI system (modeled on the DuggAI product)
- `docs/supabase.md`, `docs/stripe.md`, `sdk/README.md`
