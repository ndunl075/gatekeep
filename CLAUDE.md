# gatekeep

One endpoint (`POST /api/v1/check` with email, ip, user agent) that returns allow / challenge / block plus a score
and reason, so AI apps stop losing free credits to throwaway signups. Dashboard shows checks, blocks and
"est. credits saved".

- Read `docs/architecture.md` (contracts, scoring table, file owners) and `docs/design.md` (DuggAI look) first.
- Parallel work follows `docs/parallel-sessions.md`.
- Commands: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. CI runs all of them.
- Demo mode (no env vars) must always work: in-memory store with seeded data, demo key
  `gk_live_demo_key_for_the_playground_only`.
- Fail open: anything that goes wrong inside gatekeep returns `allow` with an `error` field, never breaks a signup.
- Use the UI primitives in `src/components/ui`; do not add new colors.
- Never commit secrets. `.env.example` lists every variable.
