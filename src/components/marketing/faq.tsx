import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {items.map((it) => (
        <details key={it.q} className="group px-4 py-3.5 sm:px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            {it.q}
            <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 max-w-[640px] text-[13px] leading-relaxed text-ink-2">{it.a}</div>
        </details>
      ))}
    </div>
  );
}
