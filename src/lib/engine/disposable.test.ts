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

describe("regression: real consumer providers and shared suffixes are not disposable", () => {
  const providers = [
    "21cn.com", "tom.com", "123.com", "158.com", "mail.by", "duck.com", "simplelogin.com", "keemail.me",
    "sina.com", "sohu.com", "126.com", "yeah.net", "aliyun.com", "rambler.ru", "seznam.cz", "wp.pl", "o2.pl",
    "interia.pl", "laposte.net", "free.fr", "sfr.fr", "virgilio.it", "rediffmail.com", "daum.net", "hanmail.net",
    "nate.com", "yahoo.co.jp", "rocketmail.com", "ymail.com", "protonmail.ch", "pm.me", "tutanota.com", "tuta.io",
    "mailbox.org", "posteo.de", "privaterelay.appleid.com",
  ];
  it.each(providers)("%s", (d) => {
    expect(isDisposableDomain(d)).toBe(false);
  });
  it.each(["ddns.net", "hopto.org", "dyndns.org", "no-ip.org", "duckdns.org", "mooo.com", "dynu.net"])(
    "dynamic DNS parent %s and its subdomains",
    (d) => {
      expect(isDisposableDomain(d)).toBe(false);
      expect(isDisposableDomain(`mail.acme.${d}`)).toBe(false);
    },
  );
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
