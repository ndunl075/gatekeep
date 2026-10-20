import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_NAV as NAV } from "@/components/marketing/docs-nav";
import { SiteHeader } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: { default: "API reference | gatekeep", template: "%s | gatekeep docs" },
  description: "gatekeep API reference: auth, the check endpoint, signals, decisions, errors and fail-open behavior.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="border-b border-line bg-chrome">
        <SiteHeader />
      </div>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:gap-12 lg:py-12">
        <aside className="shrink-0 lg:sticky lg:top-6 lg:w-[210px] lg:self-start">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Reference</div>
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {NAV.map((n) => (
              <Link
                key={n.id}
                href={`/docs#${n.id}`}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mb-2 mt-6 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint lg:block">Guides</div>
          <Link
            href="/docs/integrations"
            className="hidden rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink lg:block"
          >
            Clerk, Supabase, NextAuth
          </Link>
        </aside>
        <div className="min-w-0 flex-1 lg:max-w-[760px]">{children}</div>
      </div>
    </div>
  );
}
