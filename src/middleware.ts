import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase } from "./lib/env";
import { updateSession } from "./lib/supabase/middleware";

// Demo mode (no Supabase): nothing to do. Otherwise refresh the session and keep signed-out visitors out of
// /dashboard. This is a convenience gate; getCurrentProject() re-checks the user on every dashboard request.
export async function middleware(request: NextRequest) {
  if (!hasSupabase()) return NextResponse.next();

  const { response, user } = await updateSession(request);

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Keep any cookies the refresh just cleared or set.
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  // Only the pages that depend on the session. /api, /_next and static files never run through here.
  matcher: ["/dashboard/:path*", "/login"],
};
