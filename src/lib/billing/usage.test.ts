import { describe, expect, it } from "vitest";
import { planAction, usageSummary } from "./usage";

describe("usageSummary", () => {
  it("computes the share left and the next UTC month reset", () => {
    const u = usageSummary("pro", 2_800, new Date("2026-10-20T12:00:00Z"));
    expect(u).toMatchObject({ used: 2_800, quota: 10_000, usedPct: 28, leftPct: 72, over: false });
    expect(u.resetsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rolls the reset over the year end", () => {
    expect(usageSummary("free", 0, new Date("2026-12-31T23:59:59Z")).resetsAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("caps at 100% and flags over-quota", () => {
    expect(usageSummary("free", 500)).toMatchObject({ over: true, usedPct: 100, leftPct: 0 });
    expect(usageSummary("free", 9_999)).toMatchObject({ over: true, usedPct: 100, leftPct: 0 });
    expect(usageSummary("free", 499).over).toBe(false);
  });
});

describe("planAction", () => {
  it("orders plans", () => {
    expect(planAction("free", "pro")).toBe("upgrade");
    expect(planAction("pro", "scale")).toBe("upgrade");
    expect(planAction("scale", "pro")).toBe("downgrade");
    expect(planAction("pro", "free")).toBe("downgrade");
    expect(planAction("pro", "pro")).toBe("current");
  });
});
