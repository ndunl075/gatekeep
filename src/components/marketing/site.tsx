// Shared chrome for the public pages: header, outlined CTA, section helpers, black footer panel.
import clsx from "clsx";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header className={clsx("relative z-20 mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4 sm:px-8", className)}>
      <Link href="/" aria-label="gatekeep home">
        <Logo size={24} />
      </Link>
      <nav className="flex items-center gap-4 text-[14px] text-ink-2 sm:gap-7">
        <Link href="/docs" className="transition-colors hover:text-ink">
          Docs
        </Link>
        <Link href="/pricing" className="transition-colors hover:text-ink">
          Pricing
        </Link>
        <Link href="/login" className="transition-colors hover:text-ink">
          Sign in
        </Link>
      </nav>
    </header>
  );
}

/** The one outlined button with an arrow that Dugg uses ("Book a demo →"). */
export function CtaLink({
  href,
  children,
  arrow = true,
  quiet = false,
  className,
}: {
  href: string;
  children: ReactNode;
  arrow?: boolean;
  /** Text-only variant for the secondary link next to the CTA. */
  quiet?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "group inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] transition-colors",
        quiet ? "text-ink-2 hover:text-ink" : "border border-white/45 text-ink hover:bg-white/10",
        className,
      )}
    >
      {children}
      {arrow && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
    </Link>
  );
}

/** Huge light headline. */
export function Headline({ children, className, as: Tag = "h2" }: { children: ReactNode; className?: string; as?: "h1" | "h2" }) {
  return (
    <Tag className={clsx("text-balance font-light tracking-[-0.03em] text-ink", className)}>{children}</Tag>
  );
}

/** Headline + muted paragraph on one side, a framed shot (or any node) on the other. */
export function SplitSection({
  id,
  title,
  body,
  children,
  flip = false,
  extra,
}: {
  id?: string;
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
  flip?: boolean;
  extra?: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-8 sm:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className={clsx("lg:col-span-5", flip && "lg:order-2")}>
          <Headline className="text-[38px] leading-[1.05] sm:text-[52px]">{title}</Headline>
          <p className="mt-5 max-w-[460px] text-[16px] leading-relaxed text-ink-2">{body}</p>
          {extra && <div className="mt-6">{extra}</div>}
        </div>
        <div className={clsx("min-w-0 lg:col-span-7", flip && "lg:order-1")}>{children}</div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const cols: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: "Product",
      links: [
        { label: "Pricing", href: "/pricing" },
        { label: "Dashboard", href: "/dashboard" },
        { label: "Sign in", href: "/login" },
      ],
    },
    {
      title: "Developers",
      links: [
        { label: "API reference", href: "/docs" },
        { label: "Integrations", href: "/docs/integrations" },
        { label: "Fail open", href: "/docs#fail-open" },
      ],
    },
  ];
  return (
    <footer className="mx-auto w-full max-w-[1320px] px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="overflow-hidden rounded-[28px] bg-black px-6 pt-10 sm:px-12 sm:pt-14">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <p className="max-w-[560px] text-balance text-[26px] font-light leading-[1.2] tracking-tight text-ink sm:text-[34px]">
            Free credits are for people who want to try your product.
            <span className="text-muted"> Not for the twentieth account.</span>
          </p>
          <CtaLink href="/dashboard" className="shrink-0 self-start">
            Start free
          </CtaLink>
        </div>
        <div className="mt-12 flex flex-wrap items-start justify-between gap-8 border-t border-line pt-6 text-[13px]">
          <Logo size={20} />
          <div className="flex gap-14">
            {cols.map((c) => (
              <div key={c.title} className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{c.title}</div>
                {c.links.map((l) => (
                  <Link key={l.href + l.label} href={l.href} className="block text-ink-2 transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
        <svg aria-hidden viewBox="0 0 1000 190" className="mt-10 block w-full select-none pb-5 sm:pb-8">
          <text
            x="0"
            y="165"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontSize="220"
            fontWeight="900"
            fill="var(--color-ink-2)"
            style={{ fontFamily: "var(--font-inter), Inter, system-ui, sans-serif" }}
          >
            GATEKEEP
          </text>
        </svg>
      </div>
      <p className="mt-3 text-center text-[11px] text-white/50">gatekeep. Made for solo builders.</p>
    </footer>
  );
}
