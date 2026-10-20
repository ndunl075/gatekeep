import { getClientIp } from "./index";
import type { Decision, Gatekeep } from "./types";

export interface PrecheckOptions {
  gatekeep: Gatekeep;
}

/**
 * Route handler for a sign-up page to call BEFORE creating the user (Clerk `signUp.create`, etc.).
 * It runs on your server, so it sees the real client IP and user agent, which provider webhooks
 * (Clerk/Svix) never carry. Body: `{ email, device_id?, name? }`. Responds `{ decision }` only, so
 * scores and signals never reach the browser. Fails open: any error responds `{ decision: "allow" }`.
 */
export function createPrecheckHandler(opts: PrecheckOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    let decision: Decision = "allow";
    try {
      const body = (await req.json()) as { email?: unknown; device_id?: unknown; name?: unknown };
      if (typeof body.email === "string" && body.email) {
        const r = await opts.gatekeep.check({
          email: body.email,
          ip: getClientIp(req.headers),
          user_agent: req.headers.get("user-agent") ?? undefined,
          device_id: typeof body.device_id === "string" ? body.device_id : undefined,
          name: typeof body.name === "string" ? body.name : undefined,
        });
        decision = r.decision;
      }
    } catch (e) {
      console.warn("[gatekeep] precheck failed open:", e instanceof Error ? e.message : e);
    }
    return new Response(JSON.stringify({ decision }), { headers: { "content-type": "application/json" } });
  };
}
