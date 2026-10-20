# Deploy and go live

gatekeep is a plain Next.js app. Every integration is optional, so you can put it online in demo mode first and
switch each piece on when you have the keys.

## 1. Vercel (about 2 minutes)

1. <https://vercel.com/new> → **Import** `ndunl075/gatekeep`. Framework is detected as Next.js; keep the defaults.
2. Add environment variables (**Settings → Environment Variables**, Production + Preview). You only know the URL after
   the first deploy, so deploy once, set `NEXT_PUBLIC_APP_URL`, then redeploy:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | the deployment URL, e.g. `https://gatekeep.vercel.app` (no trailing slash) |
| `GATEKEEP_DEMO` | `1` **only** for a public demo with seeded data. Remove it once Supabase is set up. |

With just these two, the site, docs, dashboard (seeded sample data) and `POST /api/v1/check` (demo key
`gk_live_demo_key_for_the_playground_only`) all work. Demo data lives in memory and resets on cold starts.

## 2. Supabase (real accounts, keys and logs)

A Supabase project named **gatekeep** already exists (ref `sejvqxkbzvcyvnolykfe`, us-east-1) with
`supabase/migrations/0001_init.sql` applied. To use it:

1. Supabase dashboard → project **gatekeep** → **Project Settings → API**: copy the URL, the `anon` key and the
   `service_role` key.
2. Add them in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://sejvqxkbzvcyvnolykfe.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the `anon` key
   - `SUPABASE_SERVICE_ROLE_KEY` = the `service_role` key (type **Sensitive**; never expose it)
3. Remove `GATEKEEP_DEMO`.
4. Supabase → **Authentication → URL Configuration**: Site URL = your `NEXT_PUBLIC_APP_URL`, and add
   `<NEXT_PUBLIC_APP_URL>/auth/callback` to Redirect URLs.
5. Redeploy. Sign in at `/login` with a magic link; your first visit creates a project. Create a key under
   **Keys**.

Details: `docs/supabase.md`.

## 3. Upstash Redis (optional, recommended)

Without it, velocity and burst counts are answered from the `checks` table in Postgres, which is fine for small
volume. For speed: Vercel → **Storage → Upstash Redis** (free tier) and connect it to the project, or set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` by hand.

## 4. Stripe (billing)

See `docs/stripe.md`. In short: run `STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs`, paste the printed
`STRIPE_PRICE_PRO` / `STRIPE_PRICE_SCALE` into Vercel with `STRIPE_SECRET_KEY`, add a webhook endpoint
`<NEXT_PUBLIC_APP_URL>/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`. The script also creates the `EARLY3`
promotion code (3 months free) for the first customers.

## 5. Smoke test

```bash
curl -s -X POST "$APP_URL/api/v1/check" \
  -H "Authorization: Bearer $GATEKEEP_KEY" -H "Content-Type: application/json" \
  -d '{"email":"burner@mailinator.com","ip":"1.2.3.4","user_agent":"curl/8"}'
# → "decision":"block"
curl -s "$APP_URL/api/v1/health"
```
