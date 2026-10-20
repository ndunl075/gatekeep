import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST only: <form method="post" action="/auth/signout">. A GET link must not be able to sign anyone out.
export async function POST(request: NextRequest) {
  if (hasSupabase()) {
    const supabase = await createSupabaseServerClient();
    // Local scope: end this browser's session only, not every device the user is signed in on.
    await supabase.auth.signOut({ scope: "local" });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  // 303 so the browser follows with GET.
  return NextResponse.redirect(url, 303);
}
