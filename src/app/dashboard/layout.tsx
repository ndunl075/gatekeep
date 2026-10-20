import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardWindow } from "@/components/dashboard/dashboard-window";
import { Button, Card, MonoLabel } from "@/components/ui";
import { isDemoMode, isMisconfigured } from "@/lib/env";
import { getCurrentProject, getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (isMisconfigured()) {
    return (
      <DashboardWindow>
        <div className="mx-auto max-w-[520px] px-4 py-16">
          <Card className="p-5">
            <MonoLabel>Not configured</MonoLabel>
            <p className="mt-2 text-[13px] text-ink-2">
              gatekeep has no database connected. Set the Supabase environment variables, or set GATEKEEP_DEMO=1 for a demo deploy.
            </p>
          </Card>
        </div>
      </DashboardWindow>
    );
  }

  const demo = isDemoMode();
  const [project, user] = await Promise.all([getCurrentProject(), getCurrentUser()]);

  const right = (
    <div className="flex shrink-0 items-center gap-3 text-[12px]">
      <span className="hidden max-w-[140px] truncate text-ink-2 sm:inline">{project.name}</span>
      {user && <span className="hidden max-w-[180px] truncate text-muted md:inline">{user.email}</span>}
      {!demo && (
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost" className="h-6 px-2 text-[12px]">
            <LogOut size={12} />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      )}
    </div>
  );

  return (
    <DashboardWindow right={right}>
      {demo && (
        <div className="border-b border-line/60 bg-panel px-4 py-1.5 text-center text-[11px] text-muted">
          Demo mode · sample data. Connect Supabase to go live.
        </div>
      )}
      {children}
    </DashboardWindow>
  );
}
