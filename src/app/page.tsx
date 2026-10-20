import type { Metadata } from "next";
import { Code } from "@/components/ui";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { Faq } from "@/components/marketing/faq";
import { IntegrationTabs } from "@/components/marketing/integration-tabs";
import { PlanCards } from "@/components/marketing/pricing";
import { CheckDetailShot, MapShot, OverviewShot } from "@/components/marketing/shots";
import { CtaLink, Headline, SiteFooter, SiteHeader, SplitSection } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "gatekeep: stop free-credit farming",
  description:
    "One API call at signup returns allow, challenge or block, with a score and the reason. Stops throwaway accounts from burning your AI credits.",
  openGraph: {
    title: "gatekeep: stop free-credit farming",
    description: "One call at signup. Allow, challenge or block, with a score and the reason.",
  },
};

const ENDPOINT = `${env.appUrl}/api/v1/check`;

const snippets = {
  clerk: `// app/api/webhooks/clerk/route.ts  (event: user.created)
const user = evt.data;
const res = await fetch("${ENDPOINT}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.GATEKEEP_KEY}\`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: user.email_addresses[0].email_address, ip, user_agent }),
});
const { decision } = await res.json();
if (decision === "block") await clerkClient.users.deleteUser(user.id);`,
  supabase: `// Supabase Edge Function, called from your signup form
const { email } = await req.json();
const res = await fetch("${ENDPOINT}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${Deno.env.get("GATEKEEP_KEY")}\`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, ip: req.headers.get("x-forwarded-for"), user_agent: req.headers.get("user-agent") }),
});
const { decision } = await res.json();
if (decision === "block") return new Response("Signup blocked", { status: 403 });`,
  nextauth: `// auth.ts
callbacks: {
  async signIn({ user, account }) {
    if (account?.provider !== "email" && !user.email) return true;
    const res = await fetch("${ENDPOINT}", {
      method: "POST",
      headers: { Authorization: \`Bearer \${process.env.GATEKEEP_KEY}\`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email }),
    });
    const { decision } = await res.json();
    return decision !== "block";
  },
},`,
};

const faq = [
  {
    q: "Doesn't Clerk, Arcjet or Fingerprint do this?",
    a: "They do parts of it. Clerk blocks some disposable domains, Arcjet does email validation and rate limits, Fingerprint identifies devices. gatekeep puts those signals in one call: five minutes to set up, priced for solo builders, and it works with any auth.",
  },
  {
    q: "What happens if gatekeep is down?",
    a: "Your signups still work. If anything goes wrong on our side, the API returns allow with an error field. We never break a signup.",
  },
  {
    q: "Will it block real users?",
    a: "Only a high score blocks. A medium score returns challenge, so you can ask for a phone or card instead of turning someone away. Thresholds are adjustable per project, and every decision shows the signals behind it.",
  },
  {
    q: "What do you store?",
    a: "The email, IP, user agent and the decision for each check, so the dashboard can show them to you. API keys are stored as hashes.",
  },
  {
    q: "How is est. credits saved calculated?",
    a: "Blocked signups times the dollar value you set for a new account's free credits. Challenged users are not counted, since some of them are real.",
  },
  {
    q: "What happens when I pass my monthly checks?",
    a: "Checks keep working and still fail open. The response includes quota_exceeded and we email you so you can upgrade.",
  },
];

export default function Home() {
  return (
    <div className="bg-black">
      <div className="sky sky-noise relative overflow-x-clip pb-4">
        <div className="relative z-10">
          <SiteHeader />

          <section className="mx-auto max-w-[1000px] px-4 pb-16 pt-14 text-center sm:px-8 sm:pt-24">
            <Headline as="h1" className="text-[46px] leading-[1.04] sm:text-[72px] lg:text-[84px]">
              Your free tier is getting farmed.
            </Headline>
            <p className="mx-auto mt-6 max-w-[560px] text-balance text-[16px] leading-relaxed text-ink-2 sm:text-[18px]">
              People make 20 throwaway accounts for your free credits and burn your OpenAI bill. gatekeep checks every signup with one call.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <CtaLink href="/dashboard">Start free</CtaLink>
              <CtaLink href="/docs" arrow={false} quiet>
                Read the docs
              </CtaLink>
            </div>
          </section>

          <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-8">
            <OverviewShot />
          </div>

          <section id="how" className="mx-auto w-full max-w-[1120px] px-4 py-16 sm:px-8 sm:py-24">
            <div className="mx-auto mb-12 max-w-[760px] text-center">
              <Headline className="text-[38px] leading-[1.05] sm:text-[56px]">Watch it work.</Headline>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-2">
                Every signup takes the same path: read the email, IP and user agent, run the checks, return a decision. About 100,000 disposable domains, Gmail dot and plus tricks, missing mail servers, and the same IP or device making 3 or more accounts in 24 hours.
              </p>
            </div>
            <MapShot />
          </section>

          <section className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-8 sm:py-24">
            <div className="mx-auto max-w-[760px] text-center">
              <Headline className="text-[38px] leading-[1.05] sm:text-[56px]">One call at signup.</Headline>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-2">
                Send the email, IP and user agent. Get back allow, challenge (make them verify a phone or card) or block, plus a score and the reason.
              </p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-2 lg:gap-3">
              <div className="min-w-0">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">Request</div>
                <Code className="h-full bg-black/60">{`curl -X POST ${ENDPOINT} \\
  -H "Authorization: Bearer gk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "n.ico+7@gmail.com",
    "ip": "84.12.200.31",
    "user_agent": "Mozilla/5.0 (Macintosh) Safari/605.1"
  }'`}</Code>
              </div>
              <div className="min-w-0">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">Response</div>
                <Code className="h-full bg-black/60">{`{
  "decision": "challenge",
  "score": 55,
  "reason": "Same address signed up 4 times; +alias; dots ignored",
  "signals": [
    { "id": "email_reuse", "points": 35 },
    { "id": "plus_alias", "points": 10 },
    { "id": "dot_alias", "points": 10 }
  ],
  "normalized_email": "nico@gmail.com",
  "latency_ms": 31
}`}</Code>
              </div>
            </div>
          </section>

          <SplitSection
            flip
            title="Only the real abuse gets stopped."
            body="Every decision comes with the signals behind it, so you can see why a signup was blocked before you trust it. A plus alias alone is not abuse. The same address four times from one IP is."
          >
            <CheckDetailShot />
          </SplitSection>

          <SplitSection
            id="setup"
            title="Five minutes, three lines."
            body="Drop-in snippets for Clerk, Supabase Auth and NextAuth. If gatekeep is ever down, the call returns allow and your signups keep working."
          >
            <IntegrationTabs endpoint={ENDPOINT} snippets={snippets} />
          </SplitSection>

          <section id="pricing" className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-8 sm:py-24">
            <div className="mb-10 text-center">
              <Headline className="text-[38px] leading-[1.05] sm:text-[56px]">Priced for solo builders.</Headline>
              <p className="mt-4 text-[16px] text-ink-2">
                {PLANS.free.checksPerMonth.toLocaleString("en-US")} checks a month free. Pay by card through Stripe, cancel anytime.
              </p>
            </div>
            <PlanCards />
          </section>

          <section id="faq" className="mx-auto w-full max-w-[760px] px-4 py-16 sm:px-8 sm:py-24">
            <Headline className="mb-8 text-center text-[38px] leading-[1.05] sm:text-[52px]">Questions.</Headline>
            <Faq items={faq} />
          </section>

          <section className="mx-auto max-w-[800px] px-4 pb-24 pt-8 text-center sm:px-8">
            <Headline className="text-[38px] leading-[1.05] sm:text-[56px]">Stop paying for account number 20.</Headline>
            <div className="mt-8">
              <CtaLink href="/dashboard">Start free</CtaLink>
            </div>
          </section>

          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
