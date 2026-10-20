"use client";
import { TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { createKeyAction, type CreateKeyState } from "@/app/dashboard/actions";
import { Button, Card, Input, MonoLabel } from "@/components/ui";
import { CopyButton } from "./copy-button";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKeyAction, null);
  return (
    <div className="space-y-3">
      <form action={action} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input name="name" placeholder="Key name, e.g. Production" maxLength={60} required aria-label="Key name" />
          {state?.error && <p className="mt-1 text-[12px] text-block">{state.error}</p>}
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating..." : "Create key"}
        </Button>
      </form>
      {state?.plaintext && (
        <Card className="border-allow/40 p-4">
          <MonoLabel>New key · {state.name}</MonoLabel>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-md border border-line bg-[#0e0e10] px-3 py-2 font-mono text-[12px] text-ink">
              {state.plaintext}
            </code>
            <CopyButton value={state.plaintext} />
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[12px] text-challenge">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            Copy it now. This is the only time we show it; we only store a hash.
          </p>
        </Card>
      )}
    </div>
  );
}
