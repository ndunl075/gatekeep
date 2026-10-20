import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { AppContent } from "@/components/ui/app-window";
import { ButtonLink, Card, DecisionBadge, MonoLabel } from "@/components/ui";
import { formatTime, signalLabel } from "@/components/dashboard/helpers";
import { getCurrentProject } from "@/lib/session";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 break-all font-mono text-[12px] text-ink-2" : "min-w-0 break-words text-ink-2"}>{children}</dd>
    </div>
  );
}

export default async function CheckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getCurrentProject();
  const check = await getStore().getCheck(project.id, id);
  if (!check) notFound();

  return (
    <AppContent className="max-w-[760px]">
      <Link href="/dashboard/checks" className="mb-4 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink">
        <ArrowLeft size={13} /> Back to checks
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 break-all text-[18px] font-semibold tracking-tight text-ink">{check.email}</h1>
          <DecisionBadge decision={check.decision} />
        </div>
        <p className="mt-1 text-[13px] text-muted">{check.reason || "No risk signals fired."}</p>

        <dl className="mt-4 divide-y divide-line/60 border-t border-line pt-2">
          <Row label="Decision"><span className="capitalize">{check.decision}</span></Row>
          <Row label="Score" mono>{check.score} / 100</Row>
          <Row label="Normalized email" mono>{check.normalized_email}</Row>
          <Row label="IP" mono>{check.ip ?? "-"}</Row>
          <Row label="User agent" mono>{check.user_agent ?? "-"}</Row>
          <Row label="Device" mono>{check.device_id ?? "-"}</Row>
          <Row label="Latency" mono>{check.latency_ms} ms</Row>
          <Row label="Time">{formatTime(check.created_at)} UTC</Row>
        </dl>

        <div className="mt-5 border-t border-line pt-4">
          <MonoLabel className="mb-2">Signals</MonoLabel>
          {check.signals.length === 0 ? (
            <p className="text-[13px] text-muted">None. This looked like a normal signup.</p>
          ) : (
            <ul className="space-y-2">
              {check.signals.map((s, i) => (
                <li key={`${s.id}-${i}`} className="flex items-start gap-3 rounded-md border border-line bg-panel px-3 py-2">
                  <span className="tabular w-10 shrink-0 font-mono text-[12px] text-ink">+{s.points}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{signalLabel(s.id)}</div>
                    <div className="text-[12px] text-muted">{s.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <ButtonLink href="/dashboard/checks">Back to checks</ButtonLink>
        </div>
      </Card>
    </AppContent>
  );
}
