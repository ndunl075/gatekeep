# gatekeep-sdk

Block throwaway signups before they burn your free credits. Zero dependencies, fails open.

```bash
npm install gatekeep-sdk
```

```ts
import { createGatekeep, getClientIp } from "gatekeep-sdk";

const gatekeep = createGatekeep({ apiKey: process.env.GATEKEEP_API_KEY!, baseUrl: "https://your-gatekeep-host" });
const r = await gatekeep.check({ email, ip: getClientIp(req.headers), user_agent, device_id });
// r.decision: "allow" | "challenge" | "block"
```

`check()` never throws. On timeout (default 1500 ms), network error, 5xx, invalid JSON, 401 or 400 it resolves
`{ decision: "allow", score: 0, reason: "gatekeep unavailable", error }`. A bad key or request logs one `console.warn`.

## Clerk

Create a `user.created` webhook in Clerk. Verify the Svix signature yourself, then:

```ts
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { handleClerkUserCreated } from "gatekeep-sdk/clerk";

const event = new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(body, svixHeaders);
await handleClerkUserCreated({ gatekeep, clerk: await clerkClient(), event, ip, deleteOnBlock: false });
```

block bans the user (or deletes with `deleteOnBlock`), challenge sets `publicMetadata.gatekeep = "challenge"` so your
app can require phone verification, allow does nothing.

## Supabase Auth

Use the "Before User Created" HTTP hook:

```ts
import { createSupabaseBeforeUserCreatedHandler } from "gatekeep-sdk/supabase";
export const POST = createSupabaseBeforeUserCreatedHandler({ gatekeep, hookSecret: process.env.HOOK_SECRET! });
```

The handler verifies the Standard Webhooks signature (HMAC-SHA256 via WebCrypto), reads `user.email` and
`metadata.ip_address`, and returns `400 { error: { http_code, message } }` for blocks and `200 {}` otherwise.
The hook cannot change the user, so challenges are allowed; use the `onChallenge` callback to follow up.

## NextAuth / Auth.js

```ts
import { withGatekeep } from "gatekeep-sdk/nextauth";
callbacks: { signIn: withGatekeep({ gatekeep, challengeRedirect: "/verify", isExistingUser }) }
```

Block returns `false` (AccessDenied) or `blockRedirect`. Challenge returns `challengeRedirect` when set.

## Browser

Add `<script src="https://your-gatekeep-host/gatekeep.js" defer></script>` and an
`<input type="hidden" name="gk_device_id">`; it is filled with a stable per-browser id. Pass it as `device_id`.
