# Stripe billing

Optional. With no `STRIPE_SECRET_KEY`, gatekeep runs on the Free plan and the Billing page shows
"Billing is not configured". Plans live in `src/lib/plans.ts`: Free (500 checks/mo), Pro ($29, 10k), Scale ($99, 100k).
Going over quota never blocks a check (fail open); the response just carries `quota_exceeded`.

## 1. Create products, prices and the early-customer promo

Use a **test** key first (Stripe dashboard → Developers → API keys, with Test mode on).

```bash
STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
```

It is safe to re-run. It creates "gatekeep Pro" and "gatekeep Scale" with monthly prices (lookup keys
`gatekeep_pro_monthly`, `gatekeep_scale_monthly`), plus the coupon and promotion code `EARLY3`: 100% off for 3 months,
first-time customers only, max 5 redemptions. It prints the price ids to paste. For live mode use a live key
and add `--live`.

## 2. Environment variables

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` / `sk_live_...` |
| `STRIPE_PRICE_PRO` | price id printed by the script |
| `STRIPE_PRICE_SCALE` | price id printed by the script |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from step 3 |
| `NEXT_PUBLIC_APP_URL` | public URL, e.g. `https://gatekeep.example.com` (used for Checkout redirects) |

Plans are granted **only** by price id. Metadata on a Stripe object is never trusted for the plan.

## 3. Webhook endpoint

Dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://<host>/api/stripe/webhook`
- Events (exactly these four): `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Requests with a bad or missing signature get a 400.
A store failure returns 500, so Stripe retries.

## 4. Customer portal

Dashboard → Settings → Billing → Customer portal. Turn on "Cancel subscriptions" and "Update subscriptions",
and add the Pro and Scale prices as switchable products. Plan changes and cancellations for an existing subscriber
go through the portal; Checkout is only used for a first subscription, so nobody is billed twice.

## 5. Test locally with the Stripe CLI

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints a whsec_ secret for .env.local
npm run dev
# in the dashboard: Billing → Upgrade → pay with 4242 4242 4242 4242
stripe trigger customer.subscription.deleted                    # unknown project: ignored with a 200
```

`stripe trigger` fixtures belong to no project, so they are ignored; the real checkout flow is the end-to-end test
(it needs a real sign-in, see Demo mode).
Automated tests (`npm test`) cover the mapping, every event type and signature checking offline.

## Early customers: 3 months free

Share the code `EARLY3`. Checkout has `allow_promotion_codes` on, so they enter it on the Stripe page. A 100%-off
checkout still creates the subscription (and still asks for a card unless you change that in Stripe), and the plan
is granted by the same subscription events. After the 3 months the card is charged.

## How events change a plan (sync model)

Stripe delivers events out of order and retries them for days, so an event never decides the plan by itself.
For each of the four events the webhook:

1. finds the project (a customer already linked to a project wins; otherwise `metadata.project_id` /
   `client_reference_id`). A project linked to a *different* customer is refused and the event ignored.
2. asks Stripe for **all** of that customer's subscriptions (`subscriptions.list`, status `all`, paged until
   `has_more` is false, so a live subscription hidden behind many abandoned checkouts is still found).
3. picks the best live one (`active`, `trialing` or `past_due`, a price id we know, highest plan first) and sets
   the project's plan and subscription id from it, or Free with no subscription id when there is none.
4. if there is **more than one** live subscription, keeps the best (highest plan, then `active` over `trialing`
   over `past_due`, then newest) and cancels the others immediately with `prorate: true` (logged). The unused time is credited to the customer's Stripe balance, not refunded to the card:
   refund by hand in the dashboard if you want money back. Live subscriptions with a price we do not know are never
   cancelled. A failed cancel makes the webhook return 500, so Stripe retries.

`past_due` keeps the paid plan until Stripe's dunning (Smart Retries) ends and the subscription becomes `unpaid` or
`canceled`; set the retry schedule and the final action in Dashboard → Settings → Billing → Subscriptions and emails.

Because the result depends on Stripe's state at processing time, replays, duplicates and any ordering of the same
events end in the same place. If Stripe's API or our database fails, the webhook returns 500 and Stripe retries.
A live subscription whose price id we do not recognise (a missing `STRIPE_PRICE_*`) leaves the plan unchanged
instead of downgrading someone who is being charged.

## One subscription per project

Before creating a Checkout session the app asks Stripe (all pages, never our own database) whether the customer
already has an `active`, `trialing`, `past_due`, `incomplete`, `unpaid` or `paused` subscription. If so it sends the
user to the customer portal instead. It then expires any Checkout session the customer still has open, so clicking
twice or using two tabs leaves exactly one payable session. Two cases can still race: two clicks at the very same
instant, and the **first-ever checkout from two tabs**, where there is no customer yet so there is nothing to list or
expire and both sessions stay payable. If both are paid, the duplicate-subscription cleanup above cancels the extra
one, and the prorated amount lands as a **credit on the customer's Stripe balance**, not back on their card. If the
customer asks for the money back, refund it by hand in the Stripe dashboard.

## Demo mode

With `GATEKEEP_DEMO=1` (or any deploy without Supabase) the single demo project is shared and has no login, so
checkout and portal answer 503 "Billing is not available in demo mode" and the Billing page shows the plans without
buttons. Billing only works against a real, signed-in deployment.
