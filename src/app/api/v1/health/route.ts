import { getCountersName } from "@/lib/counters";
import { hasSupabase, isMisconfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which backends this deployment uses. Names only, never configuration values. 503 when production is unconfigured. */
export async function GET(): Promise<Response> {
  const misconfigured = isMisconfigured();
  return Response.json(
    {
      ok: !misconfigured,
      store: misconfigured ? "unconfigured" : hasSupabase() ? "supabase" : "memory",
      counters: getCountersName(),
    },
    { status: misconfigured ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
