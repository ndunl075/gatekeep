import { Settings2 } from "lucide-react";
import { AppContent } from "@/components/ui/app-window";
import { PageTitle, Panel, PanelHeader } from "@/components/ui";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { getCurrentProject } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const p = await getCurrentProject();
  return (
    <AppContent className="max-w-[640px]">
      <PageTitle sub="How gatekeep scores and values your signups.">Settings</PageTitle>
      <Panel>
        <PanelHeader icon={<Settings2 size={14} />} title="Project" subtitle="Applies to new checks right away" />
        <SettingsForm
          defaults={{
            name: p.name,
            creditDollars: (p.credit_value_cents / 100).toString(),
            challenge: String(p.challenge_threshold),
            block: String(p.block_threshold),
          }}
        />
      </Panel>
    </AppContent>
  );
}
