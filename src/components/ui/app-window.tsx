// The app chrome: traffic-light dots, logo, icon tabs. Used by the real dashboard and by the
// landing page's product shots, so marketing shows the actual product.
import clsx from "clsx";
import Link from "next/link";
import { BarChart3, CreditCard, KeyRound, ListChecks, Plug, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./index";

export type AppTab = "overview" | "checks" | "keys" | "integrate" | "settings" | "billing";

export const APP_TABS: { id: AppTab; label: string; href: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", href: "/dashboard", icon: BarChart3 },
  { id: "checks", label: "Checks", href: "/dashboard/checks", icon: ListChecks },
  { id: "keys", label: "Keys", href: "/dashboard/keys", icon: KeyRound },
  { id: "integrate", label: "Integrate", href: "/dashboard/integrate", icon: Plug },
  { id: "settings", label: "Settings", href: "/dashboard/settings", icon: Settings2 },
  { id: "billing", label: "Billing", href: "/dashboard/billing", icon: CreditCard },
];

export function AppWindow({
  active,
  children,
  badges,
  right,
  framed = false,
  linkTabs = true,
  className,
}: {
  active: AppTab;
  children: ReactNode;
  /** Small counts next to tab labels, like "Decisions 3". */
  badges?: Partial<Record<AppTab, ReactNode>>;
  right?: ReactNode;
  /** Adds the glowing outer frame used for product shots on the landing page. */
  framed?: boolean;
  /** False for static product shots, where tabs must not navigate. */
  linkTabs?: boolean;
  className?: string;
}) {
  const body = (
    <div className={clsx("flex min-h-0 flex-col overflow-hidden bg-canvas", framed ? "rounded-[6px]" : "min-h-screen", className)}>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line/60 bg-chrome px-3">
        <div className="hidden gap-1.5 sm:flex" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#3a3a3f]" />
          <span className="size-2.5 rounded-full bg-[#3a3a3f]" />
          <span className="size-2.5 rounded-full bg-[#3a3a3f]" />
        </div>
        <Link href="/" className="mr-2 shrink-0">
          <Logo size={18} />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {APP_TABS.map((t) => {
            const Icon = t.icon;
            const cls = clsx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors",
              t.id === active ? "bg-raised text-ink" : "text-muted hover:text-ink",
            );
            const inner = (
              <>
                <Icon size={13} strokeWidth={1.75} />
                {t.label}
                {badges?.[t.id] !== undefined && <span className="text-faint">{badges[t.id]}</span>}
              </>
            );
            return linkTabs ? (
              <Link key={t.id} href={t.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <span key={t.id} className={cls}>
                {inner}
              </span>
            );
          })}
        </nav>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );

  if (!framed) return body;
  return <div className="window-glow rounded-[8px] p-[1px]"><div className="rounded-[8px] bg-[#0b0b0d] p-1.5">{body}</div></div>;
}

/** Centered content column inside the app window (Dugg uses ~900px). */
export function AppContent({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={clsx("mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6", className)}>{children}</main>;
}
