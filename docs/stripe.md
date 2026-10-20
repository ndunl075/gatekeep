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

`stripe trigger` fixtures carry no `project_id`, so they are ignored; the real checkout flow is the end-to-end test.
Automated tests (`npm test`) cover the mapping, every event type and signature checking offline.

## Early customers: 3 months free

Share the code `EARLY3`. Checkout has `allow_promotion_codes` on, so they enter it on the Stripe page. A 100%-off
checkout still creates the subscription (and still asks for a card unless you change that in Stripe), and the plan
is granted by the same subscription events. After the 3 months the card is charged.

## How events change a plan

| Event | Effect |
|---|---|
| `checkout.session.completed` | links the Stripe customer and subscription id to the project |
| `customer.subscription.created` / `updated` | `active`, `trialing`, `past_due` → plan of the price; any other status → Free |
| `customer.subscription.deleted` | Free, subscription id cleared |

Known limits: events are applied in arrival order (a stale `updated` delivered after a newer one could briefly
show the older state until the next event); an unknown price id leaves the plan unchanged.
