import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs supabase/migrations/0001_init.sql against an in-process Postgres (PGlite) with a stub of Supabase's
// roles and auth schema, to prove the SQL applies and that the RLS policies and aggregate functions behave.

const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase grants new public objects to these roles by default; the migration must revoke what it doesn't want.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let db: PGlite;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const projA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Runs `fn` as a Supabase role, optionally with a JWT subject, then restores the superuser. */
async function as<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, fn: () => Promise<T>) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const sig = (id: string) => JSON.stringify([{ id, points: 10, detail: "x" }]);

async function addCheck(project: string, decision: string, at: string, signals = "[]") {
  await db.query(
    `insert into public.checks (project_id, created_at, email, normalized_email, email_domain, decision, score, signals)
     values ($1, $2, 'a@x.com', 'a@x.com', 'x.com', $3, 10, $4::jsonb)`,
    [project, at, decision, signals],
  );
}

// Booting PGlite and applying the migration takes ~10s when test files run in parallel; vitest's default hook
// timeout is 10s.
const SETUP_TIMEOUT = 60_000;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(MIGRATION);
  await db.query("insert into auth.users (id, email) values ($1, 'alice@x.com'), ($2, 'bob@x.com')", [alice, bob]);
  await db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'A'), ($3, $4, 'B')", [
    projA,
    alice,
    projB,
    bob,
  ]);
  await db.query(
    `insert into public.api_keys (project_id, name, prefix, key_hash) values ($1, 'k', 'gk_live_aaaa', 'hashA'), ($2, 'k', 'gk_live_bbbb', 'hashB')`,
    [projA, projB],
  );
  await addCheck(projA, "allow", new Date().toISOString());
  await addCheck(projB, "block", new Date().toISOString());
}, SETUP_TIMEOUT);

afterAll(async () => {
  await db.close();
});

describe("0001_init.sql constraints", () => {
  it("rejects out-of-range thresholds, unknown plans and bad decisions", async () => {
    await expect(db.query("update public.projects set block_threshold = 101 where id = $1", [projA])).rejects.toThrow();
    await expect(db.query("update public.projects set challenge_threshold = -1 where id = $1", [projA])).rejects.toThrow();
    await expect(db.query("update public.projects set plan = 'enterprise' where id = $1", [projA])).rejects.toThrow();
    await expect(addCheck(projA, "maybe", new Date().toISOString())).rejects.toThrow();
    await expect(addCheck(projA, "allow", new Date().toISOString(), '{"id":"x"}')).rejects.toThrow();
  });

  it("keeps key hashes unique", async () => {
    await expect(
      db.query("insert into public.api_keys (project_id, name, prefix, key_hash) values ($1, 'dup', 'gk_live_aaaa', 'hashA')", [projB]),
    ).rejects.toThrow();
  });

  it("cascades project deletes to keys and checks", async () => {
    const tmp = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'tmp')", [tmp, alice]);
    await db.query("insert into public.api_keys (project_id, name, prefix, key_hash) values ($1, 'k', 'p', 'tmpHash')", [tmp]);
    await addCheck(tmp, "allow", new Date().toISOString());
    await db.query("delete from public.projects where id = $1", [tmp]);
    expect((await db.query("select 1 from public.checks where project_id = $1", [tmp])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.api_keys where project_id = $1", [tmp])).rows).toHaveLength(0);
  });

  it("creates the required indexes", async () => {
    const { rows } = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public'");
    const defs = rows.map((r) => r.indexdef.replace(/\s+/g, " "));
    const has = (s: string) => expect(defs.some((d) => d.includes(s)), s).toBe(true);
    has("ON public.checks USING btree (project_id, created_at DESC)");
    has("ON public.checks USING btree (project_id, ip, created_at)");
    has("ON public.checks USING btree (project_id, device_id, created_at)");
    has("ON public.checks USING btree (project_id, normalized_email, created_at)");
    has("UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash)");
    has("ON public.projects USING btree (stripe_customer_id)");
  });
});

describe("row level security", () => {
  it("lets owners read only their own project, keys and checks", async () => {
    await as("authenticated", alice, async () => {
      expect((await db.query<{ id: string }>("select id from public.projects")).rows.map((r) => r.id)).toEqual([projA]);
      expect((await db.query("select id from public.api_keys")).rows).toHaveLength(1);
      expect((await db.query<{ project_id: string }>("select project_id from public.checks")).rows.map((r) => r.project_id)).toEqual([projA]);
    });
    await as("authenticated", bob, async () => {
      expect((await db.query<{ id: string }>("select id from public.projects")).rows.map((r) => r.id)).toEqual([projB]);
    });
  });

  it("shows nothing to a user with no project and to a signed-out caller", async () => {
    await as("authenticated", "33333333-3333-4333-8333-333333333333", async () => {
      expect((await db.query("select 1 from public.projects")).rows).toHaveLength(0);
      expect((await db.query("select 1 from public.checks")).rows).toHaveLength(0);
    });
    await as("authenticated", null, async () => {
      expect((await db.query("select 1 from public.projects")).rows).toHaveLength(0);
    });
    await as("anon", null, async () => {
      await expect(db.query("select 1 from public.projects")).rejects.toThrow(/permission denied/);
      await expect(db.query("select 1 from public.checks")).rejects.toThrow(/permission denied/);
      await expect(db.query("select 1 from public.api_keys")).rejects.toThrow(/permission denied/);
    });
  });

  it("never exposes key_hash to dashboard users", async () => {
    await as("authenticated", alice, async () => {
      await expect(db.query("select key_hash from public.api_keys")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.api_keys")).rejects.toThrow(/permission denied/);
      expect((await db.query("select id, prefix, revoked_at from public.api_keys")).rows).toHaveLength(1);
    });
  });

  it("denies every write to dashboard users and anon", async () => {
    for (const [role, sub] of [
      ["authenticated", alice],
      ["anon", null],
    ] as const) {
      await as(role, sub, async () => {
        await expect(db.query("insert into public.projects (owner_id, name) values ($1, 'x')", [alice])).rejects.toThrow();
        await expect(db.query("update public.projects set name = 'pwned' where id = $1", [projA])).rejects.toThrow();
        await expect(db.query("update public.projects set plan = 'scale' where id = $1", [projA])).rejects.toThrow();
        await expect(db.query("delete from public.projects where id = $1", [projA])).rejects.toThrow();
        await expect(db.query("update public.api_keys set revoked_at = now()")).rejects.toThrow();
        await expect(db.query("delete from public.checks")).rejects.toThrow();
        await expect(addCheck(projA, "allow", new Date().toISOString())).rejects.toThrow();
      });
    }
  });

  it("enables RLS on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(["api_keys", "checks", "projects"]);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("lets the service role do everything and run the aggregates, but not anon or dashboard users", async () => {
    await as("service_role", null, async () => {
      expect((await db.query("select * from public.projects")).rows).toHaveLength(2);
      expect((await db.query("select public.gatekeep_monthly_usage($1) as n", [projA])).rows).toHaveLength(1);
    });
    for (const [role, sub] of [
      ["authenticated", alice],
      ["anon", null],
    ] as const) {
      await as(role, sub, async () => {
        await expect(db.query("select public.gatekeep_monthly_usage($1)", [projA])).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from public.gatekeep_daily_stats($1, 7)", [projA])).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from public.gatekeep_top_signals($1, 7)", [projA])).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from public.gatekeep_ensure_project($1, 'x')", [alice])).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe("gatekeep_ensure_project", () => {
  it("creates one project for a new owner and returns the same one on every later call", async () => {
    const owner = "44444444-4444-4444-8444-444444444444";
    await db.query("insert into auth.users (id, email) values ($1, 'carol@x.com')", [owner]);
    const first = await db.query<{ id: string; owner_id: string; name: string }>(
      "select * from public.gatekeep_ensure_project($1, 'My app')",
      [owner],
    );
    const second = await db.query<{ id: string }>("select * from public.gatekeep_ensure_project($1, 'Other name')", [owner]);
    expect(first.rows[0]).toMatchObject({ owner_id: owner, name: "My app" });
    expect(second.rows[0].id).toBe(first.rows[0].id);
    const { rows } = await db.query("select 1 from public.projects where owner_id = $1", [owner]);
    expect(rows).toHaveLength(1);
  });

  it("returns the oldest project when the owner already has several", async () => {
    const { rows } = await db.query<{ id: string }>("select * from public.gatekeep_ensure_project($1, 'x')", [alice]);
    const oldest = await db.query<{ id: string }>(
      "select id from public.projects where owner_id = $1 order by created_at, id limit 1",
      [alice],
    );
    expect(rows[0].id).toBe(oldest.rows[0].id);
  });

  it("is race-free: concurrent first visits yield one row", async () => {
    // PGlite runs one connection, so this only proves the logic under interleaved calls; the advisory lock is what
    // serializes real concurrent sessions.
    const owner = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users (id, email) values ($1, 'dave@x.com')", [owner]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => db.query<{ id: string }>("select * from public.gatekeep_ensure_project($1, 'My app')", [owner])),
    );
    expect(new Set(results.map((r) => r.rows[0].id)).size).toBe(1);
    expect((await db.query("select 1 from public.projects where owner_id = $1", [owner])).rows).toHaveLength(1);
  });
});

describe("aggregate functions", () => {
  const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  it("zero-fills daily stats per UTC day, oldest first, and scopes by project", async () => {
    const p = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'stats')", [p, alice]);
    await addCheck(p, "allow", `${utcDay(0)}T00:00:00.000Z`);
    await addCheck(p, "block", `${utcDay(0)}T23:59:59.999Z`);
    await addCheck(p, "challenge", `${utcDay(-2)}T12:00:00.000Z`);
    await addCheck(p, "allow", `${utcDay(-10)}T12:00:00.000Z`); // outside the window
    const { rows } = await db.query<{ day: Date; allow: string; challenge: string; block: string }>(
      "select * from public.gatekeep_daily_stats($1, 4)",
      [p],
    );
    expect(rows.map((r) => r.day.toISOString().slice(0, 10))).toEqual([utcDay(-3), utcDay(-2), utcDay(-1), utcDay(0)]);
    expect(rows.map((r) => [Number(r.allow), Number(r.challenge), Number(r.block)])).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 1],
    ]);
  });

  it("counts this UTC month only", async () => {
    const p = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'usage')", [p, alice]);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1).toISOString();
    await addCheck(p, "allow", monthStart);
    await addCheck(p, "allow", now.toISOString());
    await addCheck(p, "allow", lastMonthEnd);
    const { rows } = await db.query<{ n: string }>("select public.gatekeep_monthly_usage($1) as n", [p]);
    expect(Number(rows[0].n)).toBe(2);
  });

  it("counts signals over the window, most frequent first", async () => {
    const p = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'signals')", [p, alice]);
    const now = new Date().toISOString();
    const two = JSON.stringify([
      { id: "disposable_domain", points: 80, detail: "x" },
      { id: "plus_alias", points: 10, detail: "x" },
    ]);
    await addCheck(p, "block", now, two);
    await addCheck(p, "block", now, sig("disposable_domain"));
    await addCheck(p, "allow", now, "[]");
    await addCheck(p, "block", `${utcDay(-30)}T12:00:00.000Z`, sig("no_mx")); // outside the window
    const { rows } = await db.query<{ signal_id: string; n: string }>("select * from public.gatekeep_top_signals($1, 7)", [p]);
    expect(rows.map((r) => [r.signal_id, Number(r.n)])).toEqual([
      ["disposable_domain", 2],
      ["plus_alias", 1],
    ]);
  });
});
