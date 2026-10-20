import Stripe from "stripe";
import { NextResponse } from "next/server";
import { applyStripeEvent } from "@/lib/billing/webhook";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint. The raw body is verified against STRIPE_WEBHOOK_SECRET before anything is trusted.
 * 400 = bad signature (Stripe will not retry usefully), 500 = our failure (Stripe retries with backoff).
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });

  // The signature covers the exact bytes Stripe sent, so read the body as text, never as parsed JSON.
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await applyStripeEvent(event, getStore());
    console.info("stripe webhook", event.type, event.id, result.reason ?? (result.changed ? "applied" : "no change"));
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("stripe webhook failed", event.type, event.id, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
