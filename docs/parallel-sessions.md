# Parallel sessions rules

Several worker sessions build gatekeep at once. Each owns a set of files (see `docs/architecture.md`, "Modules and
owners", and your brief). These rules keep them from colliding.

1. **Stay in your files.** Do not edit files another session owns. If you truly need a change in a shared contract
   (`src/lib/types.ts`, `src/lib/store/types.ts`, `src/lib/plans.ts`, `src/lib/env.ts`, `package.json`,
   `globals.css`, `src/components/ui/**`), make the smallest additive change (new optional field, new export),
   and call it out in the PR description under "Shared files touched". Never rename or remove anything shared.
2. **Dependencies.** Adding an npm package is allowed; say so in the PR. Run `npm install <pkg>` so the lockfile
   updates. Do not upgrade existing packages.
3. **Branch.** Work on your own branch `feat/<task>` cut from the main SHA in your brief. One PR per task, base
   `main`. If main moves and your PR conflicts, `git merge origin/main` into your branch (never rebase +
   force-push an open PR).
4. **Checks before you open the PR.** `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
   must all pass locally. CI runs the same on GitHub.
5. **Tests.** Pure logic gets vitest tests next to it (`*.test.ts`). UI gets a build plus a quick
   render check (start `npm run dev`, curl the page for a 200 and for expected text; Playwright + the preinstalled
   Chromium may be used for a screenshot).
6. **Demo mode must keep working.** With no env vars, every page renders and `/api/v1/check` works with the demo
   key. Never make a page crash because an integration is not configured; show a clear "not configured" state.
7. **No secrets in git.** Only `.env.example` with empty values.
8. **Review gate.** You never merge. The architect session reviews (zero-context reviewer) and merges. When your
   PR is open and green locally, you are done: send the architect a one-line note if your brief says how.
9. **Design.** Follow `docs/design.md` and use the primitives in `src/components/ui`. No new color values.
