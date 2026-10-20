#!/usr/bin/env node
// Creates the gatekeep products, monthly prices and the EARLY3 promo in Stripe, then prints the env lines.
// Idempotent: run it as often as you like, it only creates what is missing.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs --live
//
// Not run in CI. Prices are never edited: to change a price, create a new one with a new lookup key by hand.
import Stripe from "stripe";
import { pathToFileURL } from "node:url";

export const PRODUCTS = [
  { plan: "pro", id: "gatekeep_pro", name: "gatekeep Pro", env: "STRIPE_PRICE_PRO", lookupKey: "gatekeep_pro_monthly", cents: 2900 },
  { plan: "scale", id: "gatekeep_scale", name: "gatekeep Scale", env: "STRIPE_PRICE_SCALE", lookupKey: "gatekeep_scale_monthly", cents: 9900 },
];

export const PROMO = { code: "EARLY3", couponId: "EARLY3", months: 3, maxRedemptions: 5 };

const isMissing = (err) => err?.code === "resource_missing" || err?.statusCode === 404;

async function ensureProduct(stripe, p, log) {
  try {
    const found = await stripe.products.retrieve(p.id);
    if (found.active) return found;
    log(`  reactivating product ${p.id}`);
    return await stripe.products.update(p.id, { active: true });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  log(`  creating product ${p.id}`);
  return stripe.products.create({ id: p.id, name: p.name, metadata: { plan: p.plan } });
}

async function ensurePrice(stripe, p, product, log) {
  const existing = await stripe.prices.list({ lookup_keys: [p.lookupKey], active: true, limit: 1 });
  if (existing.data[0]) {
    const price = existing.data[0];
    if (price.unit_amount !== p.cents || price.recurring?.interval !== "month") {
      throw new Error(
        `Price ${price.id} (${p.lookupKey}) exists but is ${price.unit_amount} / ${price.recurring?.interval}, expected ${p.cents} / month. ` +
          "Fix it in the Stripe dashboard (prices are immutable: archive it and re-run).",
      );
    }
    return price;
  }
  log(`  creating price ${p.lookupKey}`);
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: p.cents,
    recurring: { interval: "month" },
    lookup_key: p.lookupKey,
    metadata: { plan: p.plan },
  });
}

async function ensureCoupon(stripe, log) {
  try {
    return await stripe.coupons.retrieve(PROMO.couponId);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  log(`  creating coupon ${PROMO.couponId}`);
  return stripe.coupons.create({
    id: PROMO.couponId,
    name: "Early customer: 3 months free",
    percent_off: 100,
    duration: "repeating",
    duration_in_months: PROMO.months,
  });
}

async function ensurePromoCode(stripe, coupon, log) {
  const existing = await stripe.promotionCodes.list({ code: PROMO.code, active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0];
  log(`  creating promotion code ${PROMO.code} (first ${PROMO.maxRedemptions} customers)`);
  return stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: PROMO.code,
    max_redemptions: PROMO.maxRedemptions,
    restrictions: { first_time_transaction: true },
  });
}

/** Does the work against any Stripe-shaped client. Returns the env lines to paste. */
export async function setup(stripe, log = console.log) {
  const lines = [];
  for (const p of PRODUCTS) {
    log(`${p.name}`);
    const product = await ensureProduct(stripe, p, log);
    const price = await ensurePrice(stripe, p, product, log);
    lines.push(`${p.env}=${price.id}`);
  }
  log(`Promo ${PROMO.code}`);
  const coupon = await ensureCoupon(stripe, log);
  await ensurePromoCode(stripe, coupon, log);
  return lines;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Set STRIPE_SECRET_KEY first (a test key starts with sk_test_).");
    process.exit(1);
  }
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (live && !process.argv.includes("--live")) {
    console.error("That is a live key. Re-run with --live to create products in live mode.");
    process.exit(1);
  }
  console.log(`Stripe ${live ? "LIVE" : "test"} mode`);
  const lines = await setup(new Stripe(key));
  console.log("\nAdd these to your environment (Vercel project settings or .env.local):\n");
  console.log(lines.join("\n"));
  console.log("\nSTRIPE_WEBHOOK_SECRET comes from the webhook endpoint you add next. See docs/stripe.md.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
