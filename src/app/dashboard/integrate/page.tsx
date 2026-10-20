import { headers } from "next/headers";
import Link from "next/link";
import { AppContent } from "@/components/ui/app-window";
import { MonoLabel, PageTitle, Panel, PanelHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { getSnippets } from "@/lib/snippets";
import { Playground } from "@/components/playground";
import { StackGuide } from "./stack-guide";

export const dynamic = "force-dynamic";

export default async function IntegratePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // Prefer the configured public URL; env.appUrl falls back to localhost when unset, so check the raw var.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ? env.appUrl : `${proto}://${host}`;

  return (
    <AppContent>
      <PageTitle sub="Five minutes, three steps. Gatekeep fails open, so it can never break a signup.">Integrate</PageTitle>
      <div className="space-y-4">
        <Panel>
          <PanelHeader title="1  Create a key" subtitle="Server-side only. Never ship it to the browser." />
          <div className="px-4 py-3 text-[13px] text-ink-2">
            Create an API key on the{" "}
            <Link href="/dashboard/keys" className="text-ink underline underline-offset-2">
              Keys page
            </Link>{" "}
            and store it as <code className="font-mono text-[12px]">GATEKEEP_API_KEY</code>.
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="2  Add the snippet" subtitle="Pick your stack." />
          <div className="px-4 py-3">
            <StackGuide snippets={getSnippets(baseUrl)} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="3  Send a test signup" subtitle="Disposable domains score 80 and are blocked." />
          <div className="space-y-4 px-4 py-3">
            <Playground />
            <div>
              <MonoLabel className="mb-1.5">Then check the dashboard</MonoLabel>
              <p className="text-[13px] text-ink-2">
                Recorded runs appear on{" "}
                <Link href="/dashboard/checks" className="text-ink underline underline-offset-2">
                  Checks
                </Link>
                .
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </AppContent>
  );
}
