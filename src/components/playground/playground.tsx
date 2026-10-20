"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Card, DecisionBadge, Input, MonoLabel } from "@/components/ui";
import { runPlaygroundCheck, type PlaygroundState } from "@/app/dashboard/playground-action";

interface Fields {
  email: string;
  ip: string;
  user_agent: string;
  device_id: string;
  name: string;
}

const EMPTY: Fields = { email: "", ip: "", user_agent: "", device_id: "", name: "" };

const PRESETS: { label: string; fields: Partial<Fields> }[] = [
  { label: "Gmail alias", fields: { email: "n.ico+7@gmail.com" } },
  { label: "Burner", fields: { email: "burner@mailinator.com" } },
  { label: "curl user agent", fields: { email: "maya@northwind.io", user_agent: "curl/8.5.0" } },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <MonoLabel className="mb-1">{label}</MonoLabel>
      {children}
    </label>
  );
}

export function Playground() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [dryRun, setDryRun] = useState(false);
  const [state, setState] = useState<PlaygroundState | null>(null);
  const [pending, start] = useTransition();

  // The browser's own user agent is the realistic default; it is only known on the client.
  useEffect(() => {
    setFields((f) => (f.user_agent ? f : { ...f, user_agent: navigator.userAgent }));
  }, []);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        setState(await runPlaygroundCheck({ ...fields, dryRun }));
      } catch {
        setState({ ok: false, error: "Could not run the check. Try again." });
      }
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <MonoLabel className="mr-1">Presets</MonoLabel>
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="secondary"
              className="h-7 px-2.5 text-[12px]"
              onClick={() => setFields((f) => ({ ...f, ...p.fields }))}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <Input value={fields.email} onChange={set("email")} placeholder="you@example.com" autoComplete="off" required />
          </Field>
          <Field label="IP (optional)">
            <Input value={fields.ip} onChange={set("ip")} placeholder="203.0.113.7" autoComplete="off" />
          </Field>
          <Field label="User agent">
            <Input value={fields.user_agent} onChange={set("user_agent")} autoComplete="off" />
          </Field>
          <Field label="Name (optional)">
            <Input value={fields.name} onChange={set("name")} placeholder="Maya Chen" autoComplete="off" />
          </Field>
          <Field label="Device id (optional)">
            <Input value={fields.device_id} onChange={set("device_id")} autoComplete="off" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="size-3.5 accent-white"
            />
            Dry run (don&apos;t record)
          </label>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Checking..." : "Run check"}
          </Button>
        </div>
      </form>

      {state && (
        <Card className="px-3.5 py-3" aria-live="polite">
          {state.ok ? (
            <Result state={state} />
          ) : (
            <p className="text-[13px] text-block">{state.error}</p>
          )}
        </Card>
      )}
    </div>
  );
}

function Result({ state }: { state: Extract<PlaygroundState, { ok: true }> }) {
  const { result } = state;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <DecisionBadge decision={result.decision} />
        <span className="flex items-baseline gap-1.5">
          <span className="tabular text-[26px] font-light leading-none tracking-tight text-ink">{result.score}</span>
          <span className="text-[12px] text-muted">/ 100 risk</span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {result.latency_ms}ms · {state.dryRun ? "not recorded" : "recorded"}
        </span>
      </div>
      <p className="text-[13px] text-ink-2">{result.reason}</p>
      {result.error && <p className="text-[12px] text-challenge">gatekeep failed open: {result.error}</p>}
      <div>
        <MonoLabel className="mb-1.5">Signals</MonoLabel>
        {result.signals.length === 0 ? (
          <p className="text-[12px] text-muted">None. This looks like a real signup.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {result.signals.map((s) => (
              <li key={s.id} className="flex items-baseline gap-3 px-3 py-1.5 text-[12px]">
                <span className="font-mono text-ink">{s.id}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{s.detail}</span>
                <span className="tabular font-mono text-ink-2">+{s.points}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="font-mono text-[11px] text-faint">normalized: {result.normalized_email}</div>
    </div>
  );
}
