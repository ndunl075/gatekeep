// Integration snippets as data, shared by the dashboard Integrate page and the public docs.

export type StackId = "curl" | "node" | "clerk" | "supabase" | "nextauth" | "browser";

export interface Snippet {
  id: StackId;
  label: string;
  /** One line shown above the code. */
  intro: string;
  steps: { title: string; lang: string; code: string }[];
}

export const KEY_PLACEHOLDER = "gk_live_YOUR_KEY";

export function getSnippets(baseUrl: string, key: string = KEY_PLACEHOLDER): Snippet[] {
  const base = baseUrl.replace(/\/+$/, "");
  return [
    {
      id: "curl",
      label: "cURL",
      intro: "One request per signup. Works from any language.",
      steps: [
        {
          title: "Check a signup",
          lang: "bash",
          code: `curl -X POST ${base}/api/v1/check \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"jane@mailinator.com","ip":"203.0.113.7","user_agent":"Mozilla/5.0"}'

# {"decision":"block","score":80,"reason":"disposable_domain", ...}`,
        },
      ],
    },
    {
      id: "node",
      label: "Node",
      intro: "The SDK never throws. If gatekeep is slow or down it returns allow, so signups keep working.",
      steps: [
        { title: "Install", lang: "bash", code: "npm install gatekeep-sdk" },
        {
          title: "Check on signup",
          lang: "ts",
          code: `import { createGatekeep, getClientIp } from "gatekeep-sdk";

const gatekeep = createGatekeep({
  apiKey: process.env.GATEKEEP_API_KEY!, // ${key}
  baseUrl: "${base}",
});

export async function POST(req: Request) {
  const { email, device_id } = await req.json();
  const r = await gatekeep.check({
    email,
    ip: getClientIp(req.headers),
    user_agent: req.headers.get("user-agent") ?? undefined,
    device_id,
  });
  if (r.decision === "block") return Response.json({ error: "Signup blocked" }, { status: 403 });
  if (r.decision === "challenge") return Response.json({ verify: true });
  // ...create the user
}`,
        },
      ],
    },
    {
      id: "clerk",
      label: "Clerk",
      intro: "Two parts: a pre-check route your sign-up page calls (real IP, stops blocked signups early) and a user.created webhook as server-side enforcement (bans blocked users, flags challenged ones).",
      steps: [
        { title: "Install", lang: "bash", code: "npm install gatekeep-sdk svix" },
        {
          title: "app/api/clerk/route.ts",
          lang: "ts",
          code: `import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { createGatekeep } from "gatekeep-sdk";
import { handleClerkUserCreated } from "gatekeep-sdk/clerk";

const gatekeep = createGatekeep({ apiKey: process.env.GATEKEEP_API_KEY!, baseUrl: "${base}" });

export async function POST(req: Request) {
  const body = await req.text();
  const event = new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(body, {
    "svix-id": req.headers.get("svix-id")!,
    "svix-timestamp": req.headers.get("svix-timestamp")!,
    "svix-signature": req.headers.get("svix-signature")!,
  }) as { type: string; data: any };

  if (event.type === "user.created") {
    // Server-side enforcement by email. No ip here: this request comes from Clerk/Svix, not the user.
    await handleClerkUserCreated({ gatekeep, clerk: await clerkClient(), event });
  }
  return new Response("ok");
}`,
        },
        {
          title: "app/api/gatekeep/precheck/route.ts (real client IP)",
          lang: "ts",
          code: `// Webhooks never carry the user's IP, so call this from your sign-up page before signUp.create.
import { createGatekeep } from "gatekeep-sdk";
import { createPrecheckHandler } from "gatekeep-sdk/precheck";

export const POST = createPrecheckHandler({
  gatekeep: createGatekeep({ apiKey: process.env.GATEKEEP_API_KEY!, baseUrl: "${base}" }),
});
// Responds { decision } only. Reads the real IP and user agent from the request.`,
        },
        {
          title: "Sign-up page: call it before signUp.create",
          lang: "ts",
          code: `const res = await fetch("/api/gatekeep/precheck", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, device_id: window.gatekeep?.deviceId() }),
});
const { decision } = await res.json();
if (decision === "block") return setError("We couldn't create this account.");
if (decision === "challenge") return router.push("/verify-phone");
await signUp.create({ emailAddress: email, password });`,
        },
        {
          title: "Handle challenged users (optional)",
          lang: "ts",
          code: `// In middleware or a server component:
if (sessionClaims?.publicMetadata?.gatekeep === "challenge") redirect("/verify-phone");`,
        },
      ],
    },
    {
      id: "supabase",
      label: "Supabase",
      intro: "Use the Before User Created auth hook. Blocked signups are rejected before the user row exists.",
      steps: [
        { title: "Install", lang: "bash", code: "npm install gatekeep-sdk" },
        {
          title: "app/api/auth-hook/route.ts",
          lang: "ts",
          code: `import { createGatekeep } from "gatekeep-sdk";
import { createSupabaseBeforeUserCreatedHandler } from "gatekeep-sdk/supabase";

export const POST = createSupabaseBeforeUserCreatedHandler({
  gatekeep: createGatekeep({ apiKey: process.env.GATEKEEP_API_KEY!, baseUrl: "${base}" }),
  hookSecret: process.env.SUPABASE_BEFORE_USER_CREATED_SECRET!, // v1,whsec_...
});`,
        },
        {
          title: "Enable the hook",
          lang: "text",
          code: `Supabase dashboard > Authentication > Auth Hooks > Before User Created
Type: HTTPS, URL: https://your-app.com/api/auth-hook
Generate the secret and save it as SUPABASE_BEFORE_USER_CREATED_SECRET.
Blocked signups get HTTP 400 {"error":{"http_code":400,"message":"..."}}.
A wrong or rotated secret makes the hook return 401 and Supabase rejects ALL signups. Rotate with care (see the SDK README).
The hook cannot modify the user, so challenges are allowed through (use onChallenge to follow up).`,
        },
      ],
    },
    {
      id: "nextauth",
      label: "NextAuth",
      intro: "Wrap your signIn callback. Works for OAuth and email sign-ins.",
      steps: [
        { title: "Install", lang: "bash", code: "npm install gatekeep-sdk" },
        {
          title: "auth.ts",
          lang: "ts",
          code: `import NextAuth from "next-auth";
import { headers } from "next/headers";
import { createGatekeep, getClientIp } from "gatekeep-sdk";
import { withGatekeep } from "gatekeep-sdk/nextauth";

const gatekeep = createGatekeep({ apiKey: process.env.GATEKEEP_API_KEY!, baseUrl: "${base}" });

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [/* ... */],
  callbacks: {
    signIn: withGatekeep({
      gatekeep,
      challengeRedirect: "/verify",
      isExistingUser: async (email) => !!(await db.user.findUnique({ where: { email } })),
      getRequestInfo: async () => {
        const h = await headers();
        return { ip: getClientIp(h), userAgent: h.get("user-agent") ?? undefined };
      },
    }),
  },
});`,
        },
      ],
    },
    {
      id: "browser",
      label: "Browser",
      intro: "Optional. A 1KB script gives each browser a stable device id so gatekeep can spot one person making many accounts.",
      steps: [
        {
          title: "Add the script and a hidden field",
          lang: "html",
          code: `<script src="${base}/gatekeep.js" defer></script>

<form method="post" action="/signup">
  <input name="email" type="email" required />
  <input name="gk_device_id" type="hidden" /> <!-- filled automatically -->
  <button>Sign up</button>
</form>`,
        },
        {
          title: "Or read it yourself",
          lang: "js",
          code: `const device_id = window.gatekeep.deviceId();
// send it with your signup request, then pass it as device_id to gatekeep.check()`,
        },
      ],
    },
  ];
}

export const STACK_ITEMS: { value: StackId; label: string }[] = [
  { value: "curl", label: "cURL" },
  { value: "node", label: "Node" },
  { value: "clerk", label: "Clerk" },
  { value: "supabase", label: "Supabase" },
  { value: "nextauth", label: "NextAuth" },
  { value: "browser", label: "Browser" },
];
