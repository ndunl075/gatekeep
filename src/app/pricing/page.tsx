import type { Metadata } from "next";
import { Card, MonoLabel } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import { Faq } from "@/components/marketing/faq";
import { PlanCards } from "@/components/marketing/pricing";
import { CtaLink, Headline, SiteFooter, SiteHeader } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Pricing | gatekeep",
  description: `Free for ${PLANS.free.checksPerMonth.toLocaleString("en-US")} checks a month. Pro $${PLANS.pro.priceMonthly}, Scale $${PLANS.scale.priceMonthly}. Cancel anytime.`,
  openGraph: { title: "gatekeep pricing", description: "Priced for solo builders. Cancel anytime." },
};

const faq = [
  {
    q: "What counts as a check?",
    a: "One call to POST /api/v1/check is one check, whatever the decision is. Requests with a missing or wrong key are not checks.",
  },
  {
    q: "What happens if I go over my monthly checks?",
    a: "Nothing breaks. Checks keep working and fail open, the response carries quota_exceeded: true, and we email you so you can upgrade. Your signups are never blocked because of a bill.",
  },
  {
    q: "Can I cancel?",
    a: "Anytime, from the billing page. You keep your plan until the end of the period you paid for, then drop to Free.",
  },
  {
    q: "How do I pay?",
    a: "By card, through Stripe checkout. Upgrade, downgrade or cancel from the dashboard.",
  },
];

export default function PricingPage() {
  return (
    <div className="bg-black">
      <div className="sky sky-noise relative overflow-x-clip pb-4">
        <div className="relative z-10">
          <SiteHeader />
          <section className="mx-auto max-w-[900px] px-4 pb-14 pt-12 text-center sm:px-8 sm:pt-20">
            <Headline as="h1" className="text-[44px] leading-[1.05] sm:text-[68px]">
              Priced for solo builders.
            </Headline>
            <p className="mx-auto mt-5 max-w-[520px] text-[16px] leading-relaxed text-ink-2">
              Start free. Move up when your signups do. Cancel anytime.
            </p>
          </section>

          <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-8">
            <PlanCards detailed />

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Card className="p-5">
                <MonoLabel>What counts as a check</MonoLabel>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
                  Each call to the check endpoint, with a valid key, is one check. Allow, challenge and block all count the same. Looking at the dashboard does not.
                </p>
              </Card>
              <Card className="p-5">
                <MonoLabel>Over your quota</MonoLabel>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
                  Checks keep working and fail open. The response says <span className="font-mono text-[12px]">quota_exceeded</span> and we email you. No signup is lost.
                </p>
              </Card>
            </div>
          </div>

          <section className="mx-auto w-full max-w-[760px] px-4 py-20 sm:px-8">
            <Faq items={faq} />
            <div className="mt-12 text-center">
              <CtaLink href="/dashboard/billing">Choose a plan</CtaLink>
            </div>
          </section>

          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
