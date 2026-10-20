// Small helpers shared by the billing form routes.
import { env } from "../env";

/**
 * CSRF guard for the form POST routes. Sessions are cookie based, so a cross-site form could otherwise ride the
 * user's login. Browsers send Origin on cross-site POSTs; if it is present it must be this deployment. A missing
 * Origin (curl, old browsers) is allowed, since only a browser can attach the session cookie in the first place.
 * Keep this check even though the auth cookies are SameSite=Lax.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  for (const h of [req.headers.get("x-forwarded-host"), req.headers.get("host"), new URL(req.url).host]) {
    if (h) allowed.add(h);
  }
  try {
    allowed.add(new URL(env.appUrl).host);
  } catch {
    // ignore a malformed NEXT_PUBLIC_APP_URL
  }
  return allowed.has(host);
}

/** Minimal standalone page for a form POST that cannot continue (the billing page itself is the normal UI). */
export function messagePage(title: string, message: string, status: number): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;background:#0b0b0d;color:#c9c9d1;font:14px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center">
<main style="max-width:420px;padding:24px"><h1 style="font-weight:300;font-size:24px;color:#fff;margin:0 0 8px">${esc(title)}</h1>
<p style="color:#8e8ea0;margin:0 0 16px">${esc(message)}</p><a href="/dashboard/billing" style="color:#fff">Back to billing</a></main></body>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const DEMO_BILLING_MESSAGE = "Billing is not available in demo mode.";
