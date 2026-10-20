import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProject } from "@/lib/store/memory";
import { BillingError } from "@/lib/billing/stripe";

let demo = true;
const checkoutSession = vi.fn();
const portalSession = vi.fn();

vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  isDemoMode: () => demo,
  hasStripe: () => true,
}));
vi.mock("@/lib/session", () => ({
  getCurrentProject: async () => defaultProject("owner", "Acme"),
  getCurrentUser: async () => ({ id: "owner", email: "a@b.test" }),
}));
vi.mock("@/lib/billing/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/stripe")>()),
  createCheckoutSession: (...a: unknown[]) => checkoutSession(...a),
  createPortalSession: (...a: unknown[]) => portalSession(...a),
}));

const form = (plan?: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/stripe/x", {
    method: "POST",
    body: new URLSearchParams(plan ? { plan } : {}),
    headers,
  });

beforeEach(() => {
  demo = false;
  checkoutSession.mockReset();
  portalSession.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("demo mode", () => {
  it("checkout answers 503 and never touches Stripe", async () => {
    demo = true;
    const { POST } = await import("./checkout/route");
    const res = await POST(form("pro"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Billing is not available in demo mode");
    expect(checkoutSession).not.toHaveBeenCalled();
  });

  it("portal answers 503 and never opens a portal session", async () => {
    demo = true;
    const { POST } = await import("./portal/route");
    const res = await POST(form());
    expect(res.status).toBe(503);
    expect(portalSession).not.toHaveBeenCalled();
  });
});

describe("checkout route", () => {
  it("303s to the Stripe URL", async () => {
    checkoutSession.mockResolvedValue("https://checkout.stripe.test/s");
    const { POST } = await import("./checkout/route");
    const res = await POST(form("pro"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.test/s");
    expect(checkoutSession.mock.calls[0][1]).toBe("pro");
  });

  it("sends an existing subscriber to the portal instead", async () => {
    checkoutSession.mockRejectedValue(new BillingError("already_subscribed", "x"));
    portalSession.mockResolvedValue("https://portal.stripe.test/p");
    const { POST } = await import("./checkout/route");
    const res = await POST(form("scale"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://portal.stripe.test/p");
  });

  it("rejects free and unknown plans, and cross-origin posts", async () => {
    const { POST } = await import("./checkout/route");
    for (const plan of ["free", "enterprise", undefined]) {
      const res = await POST(form(plan));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toContain("status=error");
    }
    const cross = await POST(form("pro", { origin: "https://evil.test" }));
    expect(cross.status).toBe(403);
    expect(checkoutSession).not.toHaveBeenCalled();
  });
});
