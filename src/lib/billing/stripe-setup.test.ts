import { describe, expect, it, vi } from "vitest";
import { PLANS } from "../plans";
import { PRODUCTS, PROMO, setup } from "../../../scripts/stripe-setup.mjs";

/** In-memory stand-in for the parts of the Stripe API the script touches. */
function fakeStripe() {
  const products = new Map<string, { id: string; active: boolean }>();
  const prices: { id: string; lookup_key: string; unit_amount: number; recurring: { interval: string }; active: boolean }[] = [];
  const coupons = new Map<string, { id: string }>();
  const promos: { id: string; code: string; active: boolean }[] = [];
  const notFound = () => Object.assign(new Error("No such object"), { code: "resource_missing" });
  const api = {
    products: {
      retrieve: vi.fn(async (id: string) => products.get(id) ?? Promise.reject(notFound())),
      create: vi.fn(async (p: { id: string }) => {
        const row = { id: p.id, active: true };
        products.set(p.id, row);
        return row;
      }),
      update: vi.fn(async (id: string, patch: { active: boolean }) => Object.assign(products.get(id)!, patch)),
    },
    prices: {
      list: vi.fn(async (q: { lookup_keys: string[] }) => ({ data: prices.filter((p) => q.lookup_keys.includes(p.lookup_key) && p.active) })),
      create: vi.fn(async (p: { lookup_key: string; unit_amount: number; recurring: { interval: string } }) => {
        const row = { id: `price_${prices.length + 1}`, active: true, ...p };
        prices.push(row);
        return row;
      }),
    },
    coupons: {
      retrieve: vi.fn(async (id: string) => coupons.get(id) ?? Promise.reject(notFound())),
      create: vi.fn(async (c: { id: string }) => {
        coupons.set(c.id, { id: c.id });
        return { id: c.id };
      }),
    },
    promotionCodes: {
      list: vi.fn(async (q: { code: string }) => ({ data: promos.filter((p) => p.code === q.code && p.active) })),
      create: vi.fn(async (p: { code: string }) => {
        const row = { id: `promo_${promos.length + 1}`, active: true, code: p.code };
        promos.push(row);
        return row;
      }),
    },
  };
  return { api, prices };
}

describe("scripts/stripe-setup.mjs", () => {
  it("creates products, monthly prices, the EARLY3 coupon and code, and prints env lines", async () => {
    const { api, prices } = fakeStripe();
    const lines = await setup(api, () => {});
    expect(lines).toEqual(["STRIPE_PRICE_PRO=price_1", "STRIPE_PRICE_SCALE=price_2"]);
    expect(prices.map((p) => [p.lookup_key, p.unit_amount, p.recurring.interval])).toEqual([
      ["gatekeep_pro_monthly", 2900, "month"],
      ["gatekeep_scale_monthly", 9900, "month"],
    ]);
    expect(api.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "EARLY3", percent_off: 100, duration: "repeating", duration_in_months: 3 }),
    );
    expect(api.promotionCodes.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EARLY3", max_redemptions: 5, promotion: { type: "coupon", coupon: "EARLY3" } }),
    );
  });

  it("is idempotent: a second run creates nothing and prints the same lines", async () => {
    const { api } = fakeStripe();
    const first = await setup(api, () => {});
    const calls = () =>
      [api.products.create, api.prices.create, api.coupons.create, api.promotionCodes.create].map((f) => f.mock.calls.length);
    const before = calls();
    expect(await setup(api, () => {})).toEqual(first);
    expect(calls()).toEqual(before);
  });

  it("refuses to continue when an existing price has the wrong amount", async () => {
    const { api, prices } = fakeStripe();
    prices.push({ id: "price_x", lookup_key: PRODUCTS[0].lookupKey, unit_amount: 1900, recurring: { interval: "month" }, active: true });
    await expect(setup(api, () => {})).rejects.toThrow(/expected 2900/);
  });

  it("matches the plan table", () => {
    expect(PRODUCTS.map((p: { cents: number }) => p.cents)).toEqual([PLANS.pro.priceMonthly * 100, PLANS.scale.priceMonthly * 100]);
    expect(PROMO.maxRedemptions).toBe(5);
  });
});
