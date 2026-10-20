import { describe, expect, it } from "vitest";
import { botUserAgent } from "./bot";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("botUserAgent", () => {
  it.each([undefined, null, "", "   "])("flags missing user agent %j", (ua) => {
    expect(botUserAgent(ua)).toBe("missing");
  });

  it.each([
    "curl/8.4.0",
    "Wget/1.21.4",
    "python-requests/2.31.0",
    "python-httpx/0.27.0",
    "Python-urllib/3.11",
    "aiohttp/3.9.1",
    "httpx",
    "Go-http-client/2.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "axios/1.6.8",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1",
    "Puppeteer",
    "Playwright/1.45",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "SomeSpider/1.0",
    "MyCrawler 3.2",
  ])("flags %s", (ua) => {
    expect(botUserAgent(ua)).not.toBeNull();
    expect(botUserAgent(ua)).not.toBe("missing");
  });

  it.each([CHROME, SAFARI_IOS])("allows real browsers", (ua) => {
    expect(botUserAgent(ua)).toBeNull();
  });
});
