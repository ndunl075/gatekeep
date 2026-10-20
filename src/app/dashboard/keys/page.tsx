import { KeyRound } from "lucide-react";
import { AppContent } from "@/components/ui/app-window";
import { PageTitle, Panel, PanelHeader, cx } from "@/components/ui";
import { CreateKeyForm } from "@/components/dashboard/create-key-form";
import { RevokeButton } from "@/components/dashboard/revoke-button";
import { formatTime } from "@/components/dashboard/helpers";
import { getCurrentProject } from "@/lib/session";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const project = await getCurrentProject();
  const keys = (await getStore().listKeys(project.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <AppContent>
      <PageTitle sub="Secret keys authorize calls to /api/v1/check. Keep them on your server.">API keys</PageTitle>

      <Panel>
        <PanelHeader icon={<KeyRound size={14} />} title="Create a key" subtitle="You will see the full key once" />
        <div className="p-4">
          <CreateKeyForm />
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHeader title="Your keys" subtitle={`${keys.filter((k) => !k.revoked_at).length} active`} />
        {keys.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">No keys yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-2 py-2.5 font-normal">Key</th>
                  <th className="px-2 py-2.5 font-normal">Created</th>
                  <th className="px-2 py-2.5 font-normal">Last used</th>
                  <th className="px-2 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{k.name}</td>
                    <td className="px-2 py-2.5 font-mono text-[12px] text-muted">{k.prefix}…</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted">{formatTime(k.created_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted">{k.last_used_at ? formatTime(k.last_used_at) : "Never"}</td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                        <span className={cx("size-1.5 rounded-full", k.revoked_at ? "bg-faint" : "bg-allow")} />
                        {k.revoked_at ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{!k.revoked_at && <RevokeButton keyId={k.id} name={k.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppContent>
  );
}
