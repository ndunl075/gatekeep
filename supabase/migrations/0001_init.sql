-- gatekeep: projects, API keys and check logs.
--
-- Access model
--   * The app server talks to Postgres with the service role (bypasses RLS) and scopes every query by project_id.
--   * Signed-in dashboard users (role `authenticated`) get read-only access to the rows of projects they own,
--     enforced by RLS. They have no INSERT/UPDATE/DELETE privilege at all.
--   * `anon` has no access to anything.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor. See docs/supabase.md.

-- ---------------------------------------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------------------------------------
create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references auth.users (id) on delete cascade,
  name                   text not null check (char_length(name) between 1 and 120),
  -- Dollar value, in cents, of the free credits a new signup gets. Drives "est. credits saved".
  credit_value_cents     integer not null default 50 check (credit_value_cents >= 0),
  challenge_threshold    integer not null default 40 check (challenge_threshold between 0 and 100),
  block_threshold        integer not null default 70 check (block_threshold between 0 and 100),
  plan                   text not null default 'free' check (plan in ('free', 'pro', 'scale')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id, created_at);
create index projects_stripe_customer_id_idx on public.projects (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------------------------------------
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  -- First 12 chars of the key (e.g. "gk_live_ab12"), safe to display.
  prefix       text not null,
  -- sha256 hex of the full key. The plaintext is never stored.
  key_hash     text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create unique index api_keys_key_hash_key on public.api_keys (key_hash);
create index api_keys_project_id_idx on public.api_keys (project_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------
-- checks (one row per POST /api/v1/check)
-- ---------------------------------------------------------------------------------------------------------
create table public.checks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  created_at       timestamptz not null default now(),
  email            text not null,
  normalized_email text not null,
  email_domain     text not null,
  ip               text,
  user_agent       text,
  device_id        text,
  decision         text not null check (decision in ('allow', 'challenge', 'block')),
  score            integer not null check (score between 0 and 100),
  reason           text not null default '',
  -- Array of { id, points, detail }.
  signals          jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  latency_ms       integer not null default 0 check (latency_ms >= 0)
);

create index checks_project_created_idx on public.checks (project_id, created_at desc);
create index checks_project_ip_idx on public.checks (project_id, ip, created_at);
create index checks_project_device_idx on public.checks (project_id, device_id, created_at);
create index checks_project_email_idx on public.checks (project_id, normalized_email, created_at);

-- ---------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.api_keys enable row level security;
alter table public.checks   enable row level security;

-- Start from nothing, then grant back exactly what is needed.
revoke all on public.projects, public.api_keys, public.checks from anon, authenticated;

grant select on public.projects to authenticated;
-- key_hash is deliberately not readable by dashboard users; the app never needs it in the browser.
grant select (id, project_id, name, prefix, created_at, last_used_at, revoked_at) on public.api_keys to authenticated;
grant select on public.checks to authenticated;

grant all on public.projects, public.api_keys, public.checks to service_role;

create policy "owners read their projects"
  on public.projects for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "owners read their api keys"
  on public.api_keys for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = api_keys.project_id and p.owner_id = (select auth.uid())
  ));

create policy "owners read their checks"
  on public.checks for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = checks.project_id and p.owner_id = (select auth.uid())
  ));

-- No INSERT / UPDATE / DELETE policies exist, and the roles have no such privileges: every write goes through
-- the server with the service role.

-- ---------------------------------------------------------------------------------------------------------
-- Aggregates (called by the server with the service role; plain SQL, security invoker)
-- ---------------------------------------------------------------------------------------------------------

-- Per-UTC-day decision counts for the last p_days days (today included), oldest first, zero-filled.
create function public.gatekeep_daily_stats(p_project_id uuid, p_days integer)
returns table (day date, allow bigint, challenge bigint, block bigint)
language sql stable
set search_path = public, pg_temp
as $$
  with bounds as (
    select (now() at time zone 'utc')::date as today, least(greatest(p_days, 1), 366) as n
  ),
  days as (
    select (b.today - (b.n - 1 - i))::date as day
    from bounds b, generate_series(0, (select n from bounds) - 1) as i
  )
  select
    d.day,
    count(c.id) filter (where c.decision = 'allow'),
    count(c.id) filter (where c.decision = 'challenge'),
    count(c.id) filter (where c.decision = 'block')
  from days d
  left join public.checks c
    on c.project_id = p_project_id
   and c.created_at >= (d.day::timestamp at time zone 'utc')
   and c.created_at <  ((d.day + 1)::timestamp at time zone 'utc')
  group by d.day
  order by d.day;
$$;

-- Number of checks since the start of the current UTC calendar month.
create function public.gatekeep_monthly_usage(p_project_id uuid)
returns bigint
language sql stable
set search_path = public, pg_temp
as $$
  select count(*)
  from public.checks c
  where c.project_id = p_project_id
    and c.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

-- How often each signal fired over the last p_days UTC days (today included), most frequent first.
create function public.gatekeep_top_signals(p_project_id uuid, p_days integer)
returns table (signal_id text, n bigint)
language sql stable
set search_path = public, pg_temp
as $$
  select s.elem ->> 'id' as signal_id, count(*) as n
  from public.checks c
  cross join lateral jsonb_array_elements(c.signals) as s(elem)
  where c.project_id = p_project_id
    and c.created_at >= (((now() at time zone 'utc')::date - (least(greatest(p_days, 1), 366) - 1))::timestamp at time zone 'utc')
    and s.elem ->> 'id' is not null
  group by 1
  order by n desc, signal_id;
$$;

-- The owner's oldest project, created on first use. The advisory lock serializes concurrent first visits for the
-- same owner, so they cannot each insert one (the table deliberately allows many projects per owner).
create function public.gatekeep_ensure_project(p_owner uuid, p_name text)
returns public.projects
language plpgsql
set search_path = public, pg_temp
as $$
declare
  result public.projects;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 0));
  select * into result from public.projects where owner_id = p_owner order by created_at, id limit 1;
  if found then
    return result;
  end if;
  insert into public.projects (owner_id, name) values (p_owner, p_name) returning * into result;
  return result;
end;
$$;

revoke all on function public.gatekeep_daily_stats(uuid, integer) from public, anon, authenticated;
revoke all on function public.gatekeep_monthly_usage(uuid) from public, anon, authenticated;
revoke all on function public.gatekeep_top_signals(uuid, integer) from public, anon, authenticated;
revoke all on function public.gatekeep_ensure_project(uuid, text) from public, anon, authenticated;
grant execute on function public.gatekeep_daily_stats(uuid, integer) to service_role;
grant execute on function public.gatekeep_monthly_usage(uuid) to service_role;
grant execute on function public.gatekeep_top_signals(uuid, integer) to service_role;
grant execute on function public.gatekeep_ensure_project(uuid, text) to service_role;
