import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./normalize";

describe("normalizeEmail", () => {
  const cases: [string, string, { plus?: boolean; dot?: boolean }][] = [
    ["n.ico+7@gmail.com", "nico@gmail.com", { plus: true, dot: true }],
    ["N.Ico@Gmail.com", "nico@gmail.com", { dot: true }],
    ["nico@googlemail.com", "nico@gmail.com", {}],
    ["n.i.c.o+promo@googlemail.com", "nico@gmail.com", { plus: true, dot: true }],
    ["nico+a+b@gmail.com", "nico@gmail.com", { plus: true }],
    ["nico@gmail.com", "nico@gmail.com", {}],
    ["  Nico@Gmail.COM  ", "nico@gmail.com", {}],
    ["jane+x@outlook.com", "jane@outlook.com", { plus: true }],
    ["jane+x@hotmail.com", "jane@hotmail.com", { plus: true }],
    ["jane+x@live.com", "jane@live.com", { plus: true }],
    ["jane+x@icloud.com", "jane@icloud.com", { plus: true }],
    ["jane+x@me.com", "jane@me.com", { plus: true }],
    ["jane+x@proton.me", "jane@proton.me", { plus: true }],
    ["jane+x@protonmail.com", "jane@protonmail.com", { plus: true }],
    ["jane+x@fastmail.com", "jane@fastmail.com", { plus: true }],
    ["jane-spam@yahoo.com", "jane@yahoo.com", { plus: true }],
    ["jane-spam-more@ymail.com", "jane@ymail.com", { plus: true }],
    ["jane.doe@outlook.com", "jane.doe@outlook.com", {}], // dots are significant outside gmail
    ["jane+x@example.com", "jane+x@example.com", {}], // unknown provider: leave the tag alone
    ["jane-x@gmail.com", "jane-x@gmail.com", {}], // gmail does not treat "-" specially
    ["jane+x@yahoo.com", "jane+x@yahoo.com", {}], // yahoo uses "-", not "+"
    ["j.smith@company.io", "j.smith@company.io", {}],
    ["USER@Sub.Example.CO.UK", "user@sub.example.co.uk", {}],
    ["o'brien@example.ie", "o'brien@example.ie", {}],
    ["münchen@bücher.de", "münchen@bücher.de", {}],
    ["用户@例子.中国", "用户@例子.中国", {}],
  ];
  it.each(cases)("%s → %s", (input, normalized, flags) => {
    const r = normalizeEmail(input);
    expect(r?.normalized).toBe(normalized);
    expect(r?.plusAlias).toBe(!!flags.plus);
    expect(r?.dotAlias).toBe(!!flags.dot);
    expect(r?.normalized).toBe(`${r?.local}@${r?.domain}`);
  });

  it("maps googlemail.com to gmail.com", () => {
    expect(normalizeEmail("a@googlemail.com")?.domain).toBe("gmail.com");
  });

  const invalid = [
    "",
    "   ",
    "plain",
    "@gmail.com",
    "nico@",
    "nico@@gmail.com",
    "a@b@c.com",
    "nico@gmail",
    "nico@.com",
    "nico@gmail..com",
    "nico@-gmail.com",
    "nico@gmail-.com",
    "nico@gmail.c",
    "nico@1.2.3.4",
    "nico@[1.2.3.4]",
    ".nico@gmail.com",
    "nico.@gmail.com",
    "ni..co@gmail.com",
    "ni co@gmail.com",
    "nico@gma il.com",
    "<nico@gmail.com>",
    '"nico"@gmail.com',
    "+tag@gmail.com",
    "+tag@outlook.com",
    "-x@yahoo.com",
    "nico@gmail.com.",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(64)}.com`,
    `a@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.${"f".repeat(20)}.com`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`,
  ];
  it.each(invalid)("rejects %j", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it("rejects non-strings without throwing", () => {
    expect(normalizeEmail(undefined as unknown as string)).toBeNull();
    expect(normalizeEmail(42 as unknown as string)).toBeNull();
  });

  it("accepts the maximum local length", () => {
    expect(normalizeEmail(`${"a".repeat(64)}@example.com`)).not.toBeNull();
  });
});
