import type { ReactNode } from "react";
import Link from "next/link";
import { Card, Code, MonoLabel, Panel } from "@/components/ui";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/plans";

const ENDPOINT = `${env.appUrl}/api/v1/check`;

function Section({ id, title, children, h1 = false }: { id: string; title: string; children: ReactNode; h1?: boolean }) {
  const Tag = h1 ? "h1" : "h2";
  return (
    <section id={id} className="scroll-mt-6 border-t border-line py-10 first:border-t-0 first:pt-0">
      <Tag className="mb-4 text-[26px] font-light tracking-tight text-ink">{title}</Tag>
      <div className="space-y-4 text-[14px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

const C = ({ children }: { children: ReactNode }) => (
  <code className="rounded border border-line bg-card px-1 py-px font-mono text-[12px] text-ink">{children}</code>
);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="px-3.5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3.5 py-2.5 align-top text-ink-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

const mono = (t: string) => <span className="font-mono text-[12px] text-ink">{t}</span>;

export default function DocsPage() {
  return (
    <article>
      <Section id="overview" title="API reference" h1>
        <p>
          gatekeep has one endpoint. Call it when someone signs up, and it returns <C>allow</C>, <C>challenge</C> or <C>block</C>, plus a score from 0 to 100 and the reason. You decide what to do with the answer.
        </p>
        <p>
          Using Clerk, Supabase Auth or NextAuth? Skip ahead to the{" "}
          <Link href="/docs/integrations" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
            integration guides
          </Link>
          .
        </p>
        <Code>{`POST ${ENDPOINT}`}</Code>
      </Section>

      <Section id="auth" title="Authentication">
        <p>
          Send your project key as a Bearer token. Create and revoke keys in the dashboard under Keys. Keys are shown once and stored as hashes. Keep them on your server, never in browser code.
        </p>
        <Code>{`Authorization: Bearer gk_live_...`}</Code>
        <p>
          To try it in demo mode, use <C>gk_live_demo_key_for_the_playground_only</C>. It only touches demo data.
        </p>
      </Section>

      <Section id="check" title="POST /api/v1/check">
        <p>
          JSON body. Only <C>email</C> is required, but the IP and user agent are what catch repeat signups, so send them. <C>/check</C> also works as a short path.
        </p>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            [mono("email"), "string, required", "The address being signed up."],
            [mono("ip"), "string", "The end user's IP address. Powers the same-IP check."],
            [mono("user_agent"), "string", "The end user's User-Agent header. Missing or script-like values add risk."],
            [mono("device_id"), "string", "A stable browser id from the gatekeep.js snippet. Powers the same-device check."],
            [mono("name"), "string", "The display name typed at signup. Used to spot keyboard mash."],
          ]}
        />
        <Code>{`curl -X POST ${ENDPOINT} \\
  -H "Authorization: Bearer gk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "n.ico+7@gmail.com",
    "ip": "84.12.200.31",
    "user_agent": "Mozilla/5.0 (Macintosh) Safari/605.1",
    "device_id": "d_8f2c1a",
    "name": "Nico"
  }'`}</Code>
      </Section>

      <Section id="response" title="Response">
        <p>
          <C>200 OK</C> with a JSON body.
        </p>
        <Code>{`{
  "id": "6f1c0e5e-5a67-4c4b-9f0a-0f6a1d1f5b2a",
  "decision": "challenge",
  "score": 50,
  "reason": "nico@gmail.com already signed up 4 times; +alias; dots ignored",
  "signals": [
    { "id": "email_reuse", "points": 35, "detail": "nico@gmail.com already signed up 4 times" },
    { "id": "plus_alias",  "points": 10, "detail": "Uses a +alias of n.ico@gmail.com" },
    { "id": "dot_alias",   "points": 5, "detail": "Dots in a Gmail address are ignored by Gmail" }
  ],
  "normalized_email": "nico@gmail.com",
  "latency_ms": 31
}`}</Code>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            [mono("id"), "string", "Id of this check. Matches the row in your dashboard."],
            [mono("decision"), "allow | challenge | block", "What to do with this signup."],
            [mono("score"), "number, 0 to 100", "0 is clean, 100 is certain abuse."],
            [mono("reason"), "string", "One line summary of the strongest signals."],
            [mono("signals"), "array", "Every signal that fired: id, points and a readable detail."],
            [mono("normalized_email"), "string", "The address with Gmail dots and +tags removed. Use it as your dedupe key."],
            [mono("latency_ms"), "number", "Time spent inside gatekeep."],
            [mono("quota_exceeded"), "boolean, optional", "Present and true when you are over your monthly checks. The check still ran."],
            [mono("error"), "string, optional", "Present when gatekeep itself failed. The decision is then allow."],
          ]}
        />
      </Section>

      <Section id="signals" title="Signals">
        <p>
          Each signal adds points. Points add up and are capped at 100.
        </p>
        <Table
          head={["Signal", "Points", "Fires when"]}
          rows={[
            [mono("invalid_email"), "100", "The address fails syntax checks."],
            [mono("disposable_domain"), "80", "The domain, or its parent, is on the disposable list (about 100,000 domains)."],
            [mono("no_mx"), "70", "The domain has no mail servers (and no A record fallback)."],
            [mono("ip_velocity"), "45 / 60", "3 or more / 6 or more checks from this IP in 24 hours."],
            [mono("device_velocity"), "45 / 60", "3 or more / 6 or more checks from this device_id in 24 hours."],
            [mono("email_reuse"), "35", "The normalized address was already checked in this project in the last 30 days."],
            [mono("bot_user_agent"), "30", "The user agent was sent empty, or looks like curl, python, a headless browser or a bot. Leaving user_agent out is not a signal."],
            [mono("signup_burst"), "25", "20 or more checks in the last 10 minutes, at least 5x the usual rate."],
            [mono("gibberish_email"), "25", "The part before the @ looks machine generated."],
            [mono("gibberish_name"), "20", "The name looks like keyboard mash."],
            [mono("plus_alias"), "10", "A +tag is present on a provider that supports it."],
            [mono("dot_alias"), "5", "A Gmail address contains dots, which Gmail ignores."],
          ]}
        />
        <p>
          Normalization: lowercase, <C>googlemail.com</C> becomes <C>gmail.com</C>, Gmail dots and +tags are removed, +tags are removed for Outlook, Hotmail, Live, iCloud, me.com, Proton and Fastmail, and Yahoo&apos;s -tags are removed.
        </p>
      </Section>

      <Section id="decisions" title="Decisions">
        <p>The decision comes from the score and your project thresholds. Defaults:</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["allow", "score below 40", "Let them in."],
            ["challenge", "score 40 to 69", "Ask them to verify a phone or card."],
            ["block", "score 70 and up", "Do not create the account."],
          ].map(([d, r, a]) => (
            <Card key={d} className="p-3.5">
              <div className="font-mono text-[12px] text-ink">{d}</div>
              <div className="mt-1 text-[12px] text-muted">{r}</div>
              <div className="mt-2 text-[13px] text-ink-2">{a}</div>
            </Card>
          ))}
        </div>
        <p>
          Change the thresholds per project in Settings. Only blocks count toward est. credits saved, because challenged users may be real.
        </p>
      </Section>

      <Section id="errors" title="Errors">
        <Table
          head={["Status", "Meaning", "What to do"]}
          rows={[
            [mono("400"), "The body is not JSON, or email is missing.", "Fix the request. Do not retry unchanged."],
            [mono("401"), "The key is missing, wrong or revoked.", "Check the Authorization header. Treat the signup as allowed while you fix it."],
            [mono("429"), "Too many requests too quickly.", "Retry after a short backoff, or allow the signup."],
          ]}
        />
        <p>
          Error responses are JSON with an <C>error</C> message. Problems inside gatekeep never come back as a 5xx. See fail open below.
        </p>
      </Section>

      <Section id="fail-open" title="Fail open">
        <p>
          gatekeep must never break a signup. If something fails on our side, you still get a <C>200</C> with <C>decision: &quot;allow&quot;</C> and an <C>error</C> field:
        </p>
        <Code>{`{ "decision": "allow", "score": 0, "reason": "gatekeep error", "error": "mx lookup failed", ... }`}</Code>
        <p>
          Do the same on your side. Set a timeout of about 2 seconds, and if the request fails or times out, let the signup through.
        </p>
        <Code>{`const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) }).catch(() => null);
const decision = res?.ok ? (await res.json()).decision : "allow";`}</Code>
      </Section>

      <Section id="quota" title="Quota">
        <p>
          Plans include {PLANS.free.checksPerMonth.toLocaleString("en-US")} (Free), {PLANS.pro.checksPerMonth.toLocaleString("en-US")} (Pro) or {PLANS.scale.checksPerMonth.toLocaleString("en-US")} (Scale) checks a month. Over that, checks still run and still fail open, the response gets <C>quota_exceeded: true</C>, and the dashboard shows your usage. See{" "}
          <Link href="/pricing" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
            pricing
          </Link>
          .
        </p>
      </Section>

      <Section id="latency" title="Latency">
        <p>
          The target is under 150 ms at the median. Mail server lookups time out after 1.5 seconds and are cached, so a slow DNS server cannot hold up your signup for long. <C>latency_ms</C> in the response tells you what you got.
        </p>
        <MonoLabel>Next</MonoLabel>
        <p>
          <Link href="/docs/integrations" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
            Clerk, Supabase Auth and NextAuth guides
          </Link>
        </p>
      </Section>
    </article>
  );
}
