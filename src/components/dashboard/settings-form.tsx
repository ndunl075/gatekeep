"use client";
import { useActionState } from "react";
import { updateSettingsAction, type SettingsState } from "@/app/dashboard/actions";
import { Button, Input, MonoLabel } from "@/components/ui";

export interface SettingsDefaults {
  name: string;
  creditDollars: string;
  challenge: string;
  block: string;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <MonoLabel className="mb-1.5">{label}</MonoLabel>
      {children}
      {error ? <p className="mt-1 text-[12px] text-block">{error}</p> : hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </label>
  );
}

export function SettingsForm({ defaults }: { defaults: SettingsDefaults }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, null);
  const v = { ...defaults, ...(state?.values ?? {}) };
  const e = state?.errors ?? {};
  return (
    <form action={action} className="space-y-5 p-4" key={state?.saved ? "saved" : "form"}>
      <Field label="Project name" error={e.name}>
        <Input name="name" defaultValue={v.name} maxLength={60} required />
      </Field>
      <Field label="Free credits per signup ($)" error={e.creditDollars} hint="What a new signup gets for free. Drives est. credits saved.">
        <Input name="creditDollars" defaultValue={v.creditDollars} inputMode="decimal" className="font-mono" required />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Challenge threshold" error={e.challenge} hint="Scores at or above this get a challenge.">
          <Input name="challenge" defaultValue={v.challenge} inputMode="numeric" className="font-mono" required />
        </Field>
        <Field label="Block threshold" error={e.block} hint="Scores at or above this are blocked.">
          <Input name="block" defaultValue={v.block} inputMode="numeric" className="font-mono" required />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving..." : "Save settings"}
        </Button>
        {state?.saved && <span className="text-[12px] text-allow">Saved</span>}
        {state?.message && <span className="text-[12px] text-block">{state.message}</span>}
      </div>
    </form>
  );
}
