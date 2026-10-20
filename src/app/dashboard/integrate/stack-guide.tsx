"use client";

import { useState } from "react";
import { Card, Code, MonoLabel, Segmented } from "@/components/ui";
import { STACK_ITEMS, type Snippet, type StackId } from "@/lib/snippets";
import { CopyButton } from "./copy-button";

export function StackGuide({ snippets }: { snippets: Snippet[] }) {
  const [stack, setStack] = useState<StackId>("curl");
  const s = snippets.find((x) => x.id === stack) ?? snippets[0];
  return (
    <div>
      <Segmented items={STACK_ITEMS} value={stack} onSelect={setStack} className="mb-3 max-w-full overflow-x-auto" />
      <p className="mb-3 text-[12px] text-muted">{s.intro}</p>
      <div className="space-y-3">
        {s.steps.map((st) => (
          <Card key={st.title} className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <MonoLabel>{st.title}</MonoLabel>
              <CopyButton text={st.code} />
            </div>
            <Code>{st.code}</Code>
          </Card>
        ))}
      </div>
    </div>
  );
}
