import { describe, expect, it } from "vitest";
import {
  barSegments,
  creditsSavedCents,
  formatDollars,
  greetingFor,
  niceMax,
  parseRange,
  quotaPercent,
  summarySentence,
  totals,
  weekdayLetter,
  formatTime,
  parseBefore,
} from "./helpers";
import { parseSettings } from "./schemas";

describe("parseRange", () => {
  it("accepts 7/14/30 with or without d", () => {
    expect(parseRange("14")).toBe(14);
    expect(parseRange("30d")).toBe(30);
    expect(parseRange(["7"])).toBe(7);
  });
  it("falls back to 7", () => {
    expect(parseRange(undefined)).toBe(7);
    expect(parseRange("90")).toBe(7);
    expect(parseRange("abc")).toBe(7);
  });
});

describe("formatDollars", () => {
  it("formats cents", () => {
    expect(formatDollars(10700)).toBe("$107");
    expect(formatDollars(50)).toBe("$0.50");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(128_450)).toBe("$1,285");
  });
  it("credits saved only counts blocks", () => {
    expect(creditsSavedCents(214, 50)).toBe(10700);
  });
});

describe("summary and greeting", () => {
  it("writes the sentence", () => {
    const t = { allow: 537, challenge: 61, block: 214, checked: 812 };
    expect(summarySentence(7, t, 10700)).toBe(
      "In the last 7 days gatekeep checked 812 signups, blocked 214 and challenged 61. That is about $107 in free credits kept.",
    );
    expect(summarySentence(7, totals([]), 0)).toMatch(/^No signups/);
  });
  it("greets by hour", () => {
    expect(greetingFor(8)).toBe("Good morning");
    expect(greetingFor(14)).toBe("Good afternoon");
    expect(greetingFor(21)).toBe("Good evening");
  });
});

describe("chart scaling", () => {
  it("niceMax rounds up", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(87)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(230)).toBe(500);
    expect(niceMax(500)).toBe(500);
  });
  it("barSegments stacks allow, challenge, block with a visible minimum", () => {
    const segs = barSegments({ date: "2026-10-20", allow: 50, challenge: 0, block: 1 }, 100);
    expect(segs.map((s) => s.decision)).toEqual(["allow", "block"]);
    expect(segs[0].pct).toBe(50);
    expect(segs[1].pct).toBe(1.5);
  });
  it("weekday letters", () => {
    expect(weekdayLetter("2026-10-20")).toBe("T");
    expect(weekdayLetter("2026-10-18")).toBe("S");
  });
});

describe("misc", () => {
  it("quotaPercent caps at 100", () => {
    expect(quotaPercent(250, 500)).toBe(50);
    expect(quotaPercent(900, 500)).toBe(100);
    expect(quotaPercent(1, 0)).toBe(0);
  });
  it("formatTime is UTC", () => {
    expect(formatTime("2026-10-20T14:05:00Z")).toBe("Oct 20, 14:05");
  });
});

describe("parseSettings", () => {
  const ok = { name: " Acme ", creditDollars: "0.50", challenge: "40", block: "70" };
  it("converts dollars to cents", () => {
    const r = parseSettings(ok);
    expect(r).toEqual({
      ok: true,
      values: { name: "Acme", credit_value_cents: 50, challenge_threshold: 40, block_threshold: 70 },
    });
  });
  it("rejects challenge >= block", () => {
    const r = parseSettings({ ...ok, challenge: "70" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.challenge).toMatch(/lower than block/);
  });
  it("rejects out of range, blanks and non numbers", () => {
    const r = parseSettings({ name: "", creditDollars: "abc", challenge: "-1", block: "101" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["block", "challenge", "creditDollars", "name"]);
  });
});


import { averageScoreSince, rangeStartIso } from "./queries";
import type { CheckLog } from "@/lib/types";

describe("parseBefore", () => {
  it("accepts strict ISO and normalizes", () => {
    expect(parseBefore("2026-10-20T14:05:00Z")).toBe("2026-10-20T14:05:00.000Z");
    expect(parseBefore("2026-10-20T14:05:00+02:00")).toBe("2026-10-20T12:05:00.000Z");
  });
  it("ignores everything else", () => {
    for (const v of ["", "yesterday", "2026-10-20", "Oct 20 2026", "2026-13-40T99:00:00Z"]) expect(parseBefore(v)).toBeUndefined();
  });
});

describe("parseSettings credit value", () => {
  const base = { name: "A", challenge: "40", block: "70" };
  it("converts from the string without float errors", () => {
    expect(parseSettings({ ...base, creditDollars: "0.29" })).toMatchObject({ ok: true, values: { credit_value_cents: 29 } });
    expect(parseSettings({ ...base, creditDollars: "1.1" })).toMatchObject({ ok: true, values: { credit_value_cents: 110 } });
    expect(parseSettings({ ...base, creditDollars: "5" })).toMatchObject({ ok: true, values: { credit_value_cents: 500 } });
  });
  it("rejects exponent, hex, sub-cent and negative input", () => {
    for (const v of ["1e3", "0x10", "0.285", "-1", ".5", "1,5"]) expect(parseSettings({ ...base, creditDollars: v }).ok).toBe(false);
  });
});

describe("averageScoreSince", () => {
  const mk = (n: number, hoursAgo: number, score: number): CheckLog =>
    ({ id: String(n), created_at: new Date(Date.UTC(2026, 9, 20, 12) - hoursAgo * 3_600_000).toISOString(), score }) as CheckLog;
  const rows = [mk(1, 0, 10), mk(2, 1, 20), mk(3, 2, 30), mk(4, 100, 90)];
  const store = {
    async listChecks(_p: string, o: { limit?: number; before?: string } = {}) {
      return rows.filter((r) => !o.before || r.created_at < o.before).slice(0, o.limit ?? 50);
    },
  };
  it("averages only rows inside the range", async () => {
    const r = await averageScoreSince(store, "p", rows[2].created_at);
    expect(r).toEqual({ avg: 20, count: 3, truncated: false });
  });
  it("reports truncation at the cap", async () => {
    const r = await averageScoreSince(store, "p", "2000-01-01T00:00:00.000Z", 2);
    expect(r).toEqual({ avg: 15, count: 2, truncated: true });
  });
  it("range start is the UTC midnight n-1 days back", () => {
    expect(rangeStartIso(7, Date.UTC(2026, 9, 20, 5))).toBe("2026-10-14T00:00:00.000Z");
  });
});
