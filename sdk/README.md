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

A Clerk webhook comes from Svix, so its source IP is the same for every signup. Never send it as `ip`
(it would poison `ip_velocity`); `handleClerkUserCreated` has no `ip` option for that reason. Use two parts:

1. A pre-check route your sign-up page calls before `signUp.create`. It sees the real client IP, user agent
   and the `gk_device_id` from `gatekeep.js`, and answers `{ decision }` only:

```ts
// app/api/gatekeep/precheck/route.ts
import { createPrecheckHandler } from "gatekeep-sdk/precheck";
export const POST = createPrecheckHandler({ gatekeep });
```

   The page stops on `block` and sends `challenge` to phone verification (see the integrate page for the snippet).

2. A `user.created` webhook as server-side enforcement, using email (and user agent if you have it). Verify the
   Svix signature yourself:

```ts
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { handleClerkUserCreated } from "gatekeep-sdk/clerk";

const event = new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(body, svixHeaders);
await handleClerkUserCreated({ gatekeep, clerk: await clerkClient(), event, deleteOnBlock: false });
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
The IP comes only from `metadata.ip_address` in the signed payload, never from the hook request headers.

**Secret warning.** gatekeep itself fails open, but this hook does not: a wrong or rotated secret makes the
handler return 401, and Supabase then rejects every signup (fails closed). To rotate safely: Supabase issues one secret per hook, so there is a short window after you generate a new one where
signatures from Supabase no longer match your app. Generate the new secret, update
`SUPABASE_BEFORE_USER_CREATED_SECRET` and redeploy straight away (or do it in a low-traffic window), then send a
test signup. Keep the old value until the test passes so you can roll back.

## NextAuth / Auth.js

```ts
import { withGatekeep } from "gatekeep-sdk/nextauth";
callbacks: { signIn: withGatekeep({ gatekeep, challengeRedirect: "/verify", isExistingUser }) }
```

Email-link sign-ins (`nodemailer`, `resend`, v4 `email`) are checked when the link is requested (`email.verificationRequest`), not when it is clicked. Block returns `false` (AccessDenied) or `blockRedirect`. Challenge returns `challengeRedirect` when set.

## Browser

Add `<script src="https://your-gatekeep-host/gatekeep.js" defer></script>` and an
`<input type="hidden" name="gk_device_id">`; it is filled with a stable per-browser id. Pass it as `device_id`.
