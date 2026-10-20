import { describe, expect, it } from "vitest";
import { gibberishEmailLocal, gibberishName } from "./gibberish";

const REAL_NAMES = [
  "Nguyen", "Siobhan", "Xiaoming", "Mkhize", "Tchaikovsky", "Llewellyn", "Ng", "Bjørn", "Oyelaran-Oyeyinka",
  "Szczepanski", "Przybylski", "Wojciechowski", "Krzysztof", "Hrynchyshyn", "Schmidt", "Schwarzenegger",
  "Mbeki", "Ndlovu", "Nkemelu", "Gbadamosi", "Khachaturian", "Dvořák", "Zhang", "Wang", "Hsu", "Hwang",
  "Muhammad", "Abdulrahman", "Fitzgerald", "O'Brien", "Zsolt", "Csonka", "Tsvangirai", "Vsevolod",
  "Mthembu", "Mnangagwa", "Nkrumah", "Rhys", "Ahtisaari", "Admir", "Kjeldsen", "Sjöberg", "Åkesson",
  "Łukasz", "Müller", "Guðmundsson", "Hồ Chí Minh", "Jean-Baptiste", "Mary Jane Watson", "Christopher Strength",
  "Nhlanhla", "Kalikali", "Bongani", "Thandiwe", "Lalala", "Wertz", "Wertzberger", "Wertzel", "Wlodzimierz", "Pniewski", "Mrozek", "Bzdyl", "Tlingit", "Thorsten Wertheimer", "Ewert Stewart",
  "田中太郎", "Иван Петров", "محمد", "Kowalczyk", "Papadopoulos", "Ghosh", "Bhattacharya",
];

const REAL_LOCALS = [
  "j.smith", "mchen92", "nguyen.van.an", "siobhan.o_brien", "xiaoming.li", "mkhize.s", "tchaikovsky",
  "llewellyn.jones", "bjorn.andersen", "oyelaran-oyeyinka", "john.doe1985", "jane_doe", "alex", "sam.w",
  "mike19850612", "maria.garcia", "dr.schmidt", "szczepanski.k", "a.kowalski", "wojciechowski",
  "info", "support", "hello", "contact", "admin", "noreply", "team", "sales", "jsmith", "k.nkemelu",
  "ndlovu.t", "ahmed.hassan", "nhlanhla.dube", "bongani", "wertz", "wertzberger.k", "kalikali", "li.ng", "ng", "tom", "priya.sharma07", "emma_watson", "chris.p.bacon",
  "krzysztof.kielowski", "przybylski", "gbadamosi.o", "khachaturian.a", "yuki.tanaka", "carlos.rodriguez",
  "user123", "test", "demo", "a1b2", "john+newsletter", "xyz", "mr.strength",
  "christopher.hrynchyshyn", "mthembu.zodwa", "wertheimer", "stewart.ewert",
];

const MASH = [
  "asdfgh", "xkqzvbt", "qwertyuiop", "zxcvbn123", "jfkdlsa", "asdfasdf", "qweqwe", "dfghjk", "kjhgfd",
  "lkjhgf", "mnbvcx", "xzcvbnm", "aaaaaa", "ababababab", "hjklhjkl", "sdkjfhsd", "kjsdhfkjs", "wqrtpsdfg",
  "bcdfghjk", "zzzzzz", "qazwsx", "1qaz2wsx", "plmokn", "poiuyt", "asdkjh", "fghfgh", "vbnmvbnm",
  "ghjkghjk", "xxxxxxxx", "rtyfghvbn", "qwerty", "asdfghjkl", "zxcvbnm", "yxcvbnm", "azertyuiop", "qwertzuiop", "azerty", "qwertz",
];

describe("gibberishEmailLocal", () => {
  it("has enough fixtures", () => {
    expect(REAL_NAMES.length + REAL_LOCALS.length).toBeGreaterThanOrEqual(40);
    expect(MASH.length).toBeGreaterThanOrEqual(20);
  });

  it.each(REAL_LOCALS)("does not flag real local part %s", (local) => {
    expect(gibberishEmailLocal(local)).toBe(false);
  });

  it.each(REAL_NAMES)("does not flag real name %s as an email local", (name) => {
    expect(gibberishEmailLocal(name.toLowerCase().replace(/\s+/g, "."))).toBe(false);
  });

  it.each(MASH)("flags mash %s", (local) => {
    expect(gibberishEmailLocal(local)).toBe(true);
  });

  it.each(["x7k2m9p4q1", "a8k2j9x3b5", "user8472916385", "xk7qz9vb2m", "j.asdfg", "as.df.gh.jk", "qwe.rty.uio"])(
    "flags digit soup / split mash %s",
    (local) => {
      expect(gibberishEmailLocal(local)).toBe(true);
    },
  );
});

describe("gibberishName", () => {
  it.each(REAL_NAMES)("does not flag real name %s", (name) => {
    expect(gibberishName(name)).toBe(false);
  });

  it.each([...MASH.filter((m) => /^[a-z]+$/.test(m)), "asdf", "qwer", "John asdfgh", "Ann xkqzvbt"])(
    "flags mash name %s",
    (name) => {
      expect(gibberishName(name)).toBe(true);
    },
  );

  it("ignores empty input", () => {
    expect(gibberishName("")).toBe(false);
    expect(gibberishName("   ")).toBe(false);
  });
});
