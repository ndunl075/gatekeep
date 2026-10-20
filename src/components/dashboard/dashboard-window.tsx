"use client";
// Client wrapper so the active tab follows the pathname while the layout stays a server component.
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppWindow, type AppTab } from "@/components/ui/app-window";

export function tabForPath(pathname: string): AppTab {
  const seg = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return (["checks", "keys", "integrate", "settings", "billing"] as const).find((t) => t === seg) ?? "overview";
}

export function DashboardWindow({ right, children }: { right?: ReactNode; children: ReactNode }) {
  const active = tabForPath(usePathname() ?? "/dashboard");
  return (
    <AppWindow active={active} right={right}>
      {children}
    </AppWindow>
  );
}
