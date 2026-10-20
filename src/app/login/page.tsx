import { redirect } from "next/navigation";
import { Logo, Panel } from "@/components/ui";
import { env, hasSupabase, isDemoMode } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

// Depends on env and the session cookie at request time, never on build-time values.
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in | gatekeep" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Demo mode has no accounts: the dashboard is open.
  if (isDemoMode()) redirect("/dashboard");

  const configured = hasSupabase();
  if (configured && (await getCurrentUser())) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="sky sky-noise relative grid min-h-screen place-items-center px-4">
      <Panel className="relative z-10 w-full max-w-[380px] p-6">
        <div className="mb-5 flex flex-col items-center gap-4">
          <Logo size={28} />
          <h1 className="text-[22px] font-light tracking-tight text-ink">Sign in to gatekeep</h1>
        </div>
        {configured ? (
          <LoginForm appUrl={env.appUrl} github={process.env.NEXT_PUBLIC_SUPABASE_GITHUB === "1"} linkError={Boolean(error)} />
        ) : (
          <p className="text-center text-[12px] text-muted">
            Sign-in is not configured on this deployment. Set the Supabase environment variables (see docs/supabase.md).
          </p>
        )}
      </Panel>
    </main>
  );
}
