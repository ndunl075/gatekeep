# Supabase setup

Supabase holds projects, API keys and check logs, and signs dashboard users in. Without these variables gatekeep
runs in demo mode (in-memory store, no login), so this is only needed for a real deploy.

## 1. Create the project

1. Create a project at <https://supabase.com/dashboard> (any region; pick the one closest to your Vercel region).
2. Under **Project Settings → API** copy the project URL, the `anon` key and the `service_role` key.

## 2. Apply the migration

`supabase/migrations/0001_init.sql` creates `projects`, `api_keys`, `checks`, their indexes, RLS policies and the
three aggregate functions (`gatekeep_daily_stats`, `gatekeep_monthly_usage`, `gatekeep_top_signals`).

Either paste the file into **SQL Editor → New query → Run**, or with the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

Run it once on an empty project. Later schema changes get a new numbered file; never edit `0001`.

## 3. Environment variables

| Variable | Where it comes from | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` key | yes (RLS limits what it can do) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | **never**. Server only, bypasses RLS |
| `NEXT_PUBLIC_APP_URL` | your deployment URL, e.g. `https://gatekeep.example.com` | yes |
| `NEXT_PUBLIC_SUPABASE_GITHUB` | `1` to show "Continue with GitHub" | yes |

Set them in Vercel (**Settings → Environment Variables**) and in `.env.local` for local development. All three
Supabase variables must be set together; with any of them missing gatekeep treats Supabase as unconfigured. In
production that is an error (unless `GATEKEEP_DEMO=1`), so a typo can never serve an open dashboard.

## 4. Configure auth

In **Authentication → URL Configuration**:

- **Site URL**: your `NEXT_PUBLIC_APP_URL`.
- **Redirect URLs**: add `<NEXT_PUBLIC_APP_URL>/auth/callback` (and `http://localhost:3000/auth/callback` for local
  development). Magic links to any other URL are rejected by Supabase.

The email magic link uses PKCE: the link must be opened in the **same browser** that requested it.

Optional, **GitHub sign-in**: create a GitHub OAuth app whose callback URL is the one shown in
**Authentication → Providers → GitHub**, paste its client id and secret there, then set
`NEXT_PUBLIC_SUPABASE_GITHUB=1`.

Supabase's built-in email sender is rate limited (a few messages an hour). Configure custom SMTP under
**Authentication → SMTP Settings** before real traffic.

## How access is enforced

- The app server uses the service-role client (`src/lib/supabase/admin.ts`, `server-only`). It bypasses RLS, so
  `SupabaseStore` scopes every query by `project_id` / `owner_id`, and the project always comes from the session
  (`getCurrentProject()`), never from the client.
- Dashboard users (`authenticated`) can only `SELECT` rows of projects they own (RLS), and cannot read
  `api_keys.key_hash`. They have no insert/update/delete privilege on any table. `anon` has none at all.
- The aggregate functions are executable by `service_role` only.
- The middleware (`src/middleware.ts`) redirects signed-out `/dashboard/**` requests to `/login`, and
  `getCurrentProject()` checks the user again on every dashboard request.

`src/lib/supabase/migration.test.ts` applies the migration to an in-process Postgres in CI and asserts these
rules.

## Testing against a real project

The store conformance suite (`src/lib/store/conformance.ts`) always runs against the in-memory store. To run it
against Supabase too, create a **separate throwaway project**, apply the migration, and:

```bash
SUPABASE_TEST_URL=https://<ref>.supabase.co SUPABASE_TEST_SERVICE_KEY=<service role key> npm test
```

The suite creates (and deletes) its own auth users and the projects, keys and checks under them. Never point it
at production.
