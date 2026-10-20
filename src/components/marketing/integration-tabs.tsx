"use client";

import { useState } from "react";
import { Code, Segmented } from "@/components/ui";

type Tab = "clerk" | "supabase" | "nextauth";

export function IntegrationTabs({ endpoint, snippets }: { endpoint: string; snippets: Record<Tab, string> }) {
  const [tab, setTab] = useState<Tab>("clerk");
  return (
    <div className="min-w-0">
      <Segmented
        value={tab}
        onSelect={setTab}
        items={[
          { value: "clerk", label: "Clerk" },
          { value: "supabase", label: "Supabase Auth" },
          { value: "nextauth", label: "NextAuth" },
        ]}
        className="bg-black/40"
      />
      <Code className="mt-3 min-h-[250px] bg-black/60">{snippets[tab]}</Code>
      <p className="mt-3 text-[12px] text-ink-2">
        Any auth works: it is one POST to <span className="font-mono">{endpoint}</span>.
      </p>
    </div>
  );
}
