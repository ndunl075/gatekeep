// Shared UI primitives. Look and feel follows docs/design.md (DuggAI product UI).
import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Decision } from "@/lib/types";

export { clsx as cx };

/** gatekeep mark: a gate in a rounded square, the way Dugg uses its glyph. */
export function Logo({ size = 22, withWord = true, className }: { size?: number; withWord?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="#0b0b0d" stroke="#3a3a40" />
        <path d="M7 18V9.5a5 5 0 0 1 10 0V18" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 11.5V18M7 14h10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {withWord && <span className="text-[15px] font-medium tracking-tight text-ink">gatekeep</span>}
    </span>
  );
}

/** Small uppercase monospace section label ("WHAT DUGG SEES"). */
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("font-mono text-[10px] uppercase tracking-[0.14em] text-faint", className)}>{children}</div>
  );
}

/** Large panel, e.g. the map canvas or the usage sections. */
export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("rounded-lg border border-line bg-panel", className)} {...props} />;
}

/** Card nested inside a panel. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("rounded-md border border-line bg-card", className)} {...props} />;
}

/** Panel header row: icon square, title, subtitle, right-side slot. */
export function PanelHeader({
  icon,
  title,
  subtitle,
  right,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-3 border-b border-line px-4 py-3", className)}>
      {icon && (
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-card text-muted">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{title}</div>
        {subtitle && <div className="truncate text-[12px] text-muted">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

/** Page title in the light, large style ("Good evening, Maya" / "Usage"). */
export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-light leading-tight tracking-tight text-ink">{children}</h1>
        {sub && <p className="mt-1 text-[13px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const buttonClasses: Record<ButtonVariant, string> = {
  primary: "bg-white text-black hover:bg-white/90 border border-white",
  secondary: "bg-[#1c1c1f] text-ink border border-line-2 hover:bg-raised",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised border border-transparent",
  danger: "bg-[#1c1c1f] text-block border border-line-2 hover:bg-raised",
};

export function buttonClass(variant: ButtonVariant = "secondary", className?: string) {
  return clsx(
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-[5px] px-3 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
    buttonClasses[variant],
    className,
  );
}

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

/** Segmented control ("Live | Replay | Inputs"). Pass hrefs for link tabs or onSelect for client state. */
export function Segmented<T extends string>({
  items,
  value,
  onSelect,
  className,
}: {
  items: { value: T; label: ReactNode; href?: string }[];
  value: T;
  onSelect?: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("inline-flex rounded-md border border-line bg-panel p-0.5", className)}>
      {items.map((it) => {
        const cls = clsx(
          "rounded-[4px] px-3 py-1 text-[12px] transition-colors",
          it.value === value ? "bg-raised text-ink" : "text-muted hover:text-ink",
        );
        return it.href ? (
          <Link key={it.value} href={it.href} className={cls}>
            {it.label}
          </Link>
        ) : (
          <button key={it.value} type="button" className={cls} onClick={() => onSelect?.(it.value)}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export const decisionColor: Record<Decision, string> = {
  allow: "var(--color-allow)",
  challenge: "var(--color-challenge)",
  block: "var(--color-block)",
};

export function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-line bg-card px-1.5 py-0.5 text-[11px] capitalize text-ink-2">
      <span className="size-1.5 rounded-full" style={{ background: decisionColor[decision] }} />
      {decision}
    </span>
  );
}

/** Stat card in the Dugg map style: numbered title, big light number, unit, muted footnote. */
export function StatCard({
  index,
  title,
  value,
  unit,
  foot,
  accent,
  className,
}: {
  index?: number;
  title: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <Card className={clsx("px-3.5 py-3", className)}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        {index !== undefined && (
          <span className="grid size-4 place-items-center rounded-full bg-white text-[10px] font-semibold text-black">
            {index}
          </span>
        )}
        {accent && <span className="size-1.5 rounded-full" style={{ background: accent }} />}
        {title}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-[26px] font-light leading-none tracking-tight text-ink">{value}</span>
        {unit && <span className="text-[12px] text-muted">{unit}</span>}
      </div>
      {foot && <div className="mt-1.5 truncate text-[11px] text-muted">{foot}</div>}
    </Card>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={clsx(
        "h-8 w-full rounded-[5px] border border-line-2 bg-[#111113] px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-[#55555e] focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-2 bg-card px-1 font-mono text-[10px] text-muted">{children}</kbd>
  );
}

/** Code block in the dark card style, monospace. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={clsx(
        "overflow-x-auto rounded-md border border-line bg-[#0e0e10] p-3.5 font-mono text-[12px] leading-relaxed text-ink-2",
        className,
      )}
    >
      {children}
    </pre>
  );
}
