import { headers } from "next/headers";
import Link from "next/link";
import { AppContent } from "@/components/ui/app-window";
import { MonoLabel, PageTitle, Panel, PanelHeader } from "@/components/ui";
import { getSnippets } from "@/lib/snippets";
import { StackGuide } from "./stack-guide";

export const dynamic = "force-dynamic";

export default async function IntegratePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

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
          <div className="px-4 py-3">
            <MonoLabel className="mb-1.5">Then check the dashboard</MonoLabel>
            <p className="text-[13px] text-ink-2">
              Sign up with <code className="font-mono text-[12px]">test@mailinator.com</code> and watch it appear on{" "}
              <Link href="/dashboard/checks" className="text-ink underline underline-offset-2">
                Checks
              </Link>{" "}
              as a block.
            </p>
          </div>
        </Panel>
      </div>
    </AppContent>
  );
}
