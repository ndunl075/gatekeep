import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Magic links and GitHub OAuth both land here with ?code=. Exchange it for a session cookie, then go to the dashboard.
export async function GET(request: NextRequest) {
  const to = (pathname: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = search;
    return NextResponse.redirect(url);
  };

  if (!hasSupabase()) return to("/dashboard");

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return to("/login", "?error=1");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return to("/login", "?error=1");

  return to("/dashboard");
}
