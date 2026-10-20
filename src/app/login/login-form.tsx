"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ appUrl, github, linkError }: { appUrl: string; github: boolean; linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const redirectTo = `${appUrl}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setStatus(error ? "error" : "sent");
  }

  async function withGithub() {
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (error) setStatus("error");
  }

  if (status === "sent") {
    return (
      <div className="text-center">
        <p className="text-[13px] text-ink">Check your inbox.</p>
        <p className="mt-1 text-[12px] text-muted">
          We sent a sign-in link to <span className="text-ink-2">{email.trim()}</span>. Open it in this browser.
        </p>
        <button type="button" className="mt-4 text-[12px] text-muted underline hover:text-ink" onClick={() => setStatus("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-3">
      {(linkError || status === "error") && (
        <p role="alert" className="rounded-[5px] border border-line-2 bg-card px-2.5 py-2 text-[12px] text-block">
          {status === "error" ? "Could not sign you in. Try again in a minute." : "That sign-in link is invalid or expired. Request a new one."}
        </p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Email</span>
        <Input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <Button type="submit" variant="primary" disabled={status === "sending" || !email.trim()}>
        {status === "sending" ? "Sending..." : "Email me a link"}
      </Button>
      {github && (
        <>
          <div className="flex items-center gap-3 text-[11px] text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button type="button" variant="secondary" onClick={withGithub}>
            Continue with GitHub
          </Button>
        </>
      )}
    </form>
  );
}
