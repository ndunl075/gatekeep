# gatekeep

One API call that stops bots and throwaway accounts from farming free credits on your AI app's signup.

```bash
curl -X POST https://<your-deployment>/api/v1/check \
  -H "Authorization: Bearer gk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"email":"n.ico+7@gmail.com","ip":"185.220.101.7","user_agent":"Mozilla/5.0 ..."}'
# → {"decision":"challenge","score":45,"reason":"Uses a +alias of nico@gmail.com; ...", ...}
```

## Develop

```bash
npm install
npm run dev        # http://localhost:3000, demo mode with seeded data
npm run check      # lint + typecheck + tests
```

See `docs/architecture.md` and `docs/design.md`.
