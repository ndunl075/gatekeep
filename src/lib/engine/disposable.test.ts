import { describe, expect, it } from "vitest";
import domains from "./data/disposable-domains.json";
import { DISPOSABLE_COUNT, isDisposableDomain, matchDisposable } from "./disposable";

describe("disposable list data", () => {
  it("is a large, sorted, deduped, lowercase list", () => {
    const list = domains as string[];
    expect(list.length).toBeGreaterThan(50_000);
    expect(DISPOSABLE_COUNT).toBe(list.length);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual([...list].sort());
    expect(list.every((d) => d === d.toLowerCase() && d.includes("."))).toBe(true);
  });

  it("never lists major providers", () => {
    const major = [
      "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
      "proton.me", "protonmail.com", "aol.com", "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.ru",
      "yandex.com", "qq.com", "zoho.com", "fastmail.com", "hey.com",
    ];
    for (const d of major) expect(isDisposableDomain(d), d).toBe(false);
  });
});

describe("matchDisposable", () => {
  it("matches listed domains", () => {
    expect(matchDisposable("mailinator.com")).toBe("mailinator.com");
    expect(matchDisposable("guerrillamail.com")).toBe("guerrillamail.com");
    expect(matchDisposable("10minutemail.com")).toBe("10minutemail.com");
  });
  it("matches parent domains at any depth", () => {
    expect(matchDisposable("a.mailinator.com")).toBe("mailinator.com");
    expect(matchDisposable("a.b.mailinator.com")).toBe("mailinator.com");
  });
  it("is case-insensitive", () => {
    expect(isDisposableDomain("MAILINATOR.COM")).toBe(true);
  });
  it("does not match lookalike suffixes or real domains", () => {
    expect(isDisposableDomain("notmailinator.example")).toBe(false);
    expect(isDisposableDomain("mailinator.com.example.org")).toBe(false);
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(isDisposableDomain("mail.gmail.com")).toBe(false);
    expect(isDisposableDomain("example.com")).toBe(false);
    expect(isDisposableDomain("com")).toBe(false);
    expect(isDisposableDomain("")).toBe(false);
  });
});
