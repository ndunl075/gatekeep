import { runCheck, type CheckOutcome } from "@/lib/check-service";
import { readKeyFromHeaders } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function respond(o: CheckOutcome): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Gatekeep-Latency": String(o.latencyMs),
  });
  if (o.status === 429) headers.set("Retry-After", String(o.retryAfterSec));
  if (o.status === 401) headers.set("WWW-Authenticate", 'Bearer realm="gatekeep"');
  return Response.json(o.body, { status: o.status, headers });
}

function badRequest(message: string, status = 400): Response {
  return Response.json(
    { error: "invalid_request", message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return badRequest("Could not read the request body.");
  }
  if (text.length > MAX_BODY_BYTES) return badRequest("Request body is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return badRequest("Request body must be JSON, e.g. {\"email\":\"user@example.com\"}.");
  }
  return respond(await runCheck(readKeyFromHeaders(request.headers), body));
}

function methodNotAllowed(): Response {
  return Response.json(
    { error: "method_not_allowed", message: "Use POST." },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
