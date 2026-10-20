import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Card, cx } from "@/components/ui";

type Tone = "ok" | "warn" | "info";
const tones: Record<Tone, { icon: ReactNode; color: string }> = {
  ok: { icon: <CheckCircle2 size={14} strokeWidth={1.75} />, color: "text-allow" },
  warn: { icon: <AlertTriangle size={14} strokeWidth={1.75} />, color: "text-challenge" },
  info: { icon: <Info size={14} strokeWidth={1.75} />, color: "text-muted" },
};

export function Notice({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const t = tones[tone];
  return (
    <Card className="mb-4 flex gap-2.5 px-3.5 py-3">
      <span className={cx("mt-0.5 shrink-0", t.color)}>{t.icon}</span>
      <div>
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {children && <div className="mt-0.5 text-[12px] text-muted">{children}</div>}
      </div>
    </Card>
  );
}
