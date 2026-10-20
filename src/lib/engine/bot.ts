const BOT_PATTERNS: [RegExp, string][] = [
  [/curl/i, "curl"],
  [/\bwget\b/i, "wget"],
  [/python-requests|python-urllib|python-httpx|aiohttp|\bpython\//i, "python"],
  [/\bhttpx\b/i, "httpx"],
  [/go-http-client/i, "Go-http-client"],
  [/node-fetch|undici|\baxios\b/i, "node http client"],
  [/headlesschrome|headless/i, "headless browser"],
  [/phantomjs|puppeteer|playwright|selenium|webdriver/i, "browser automation"],
  [/libwww-perl|java\/\d|okhttp|apache-httpclient|scrapy|mechanize/i, "http library"],
  // "Googlebot/2.1", "AhrefsBot/7.0", "SomeSpider/1.0": product token ending in bot/spider/crawler.
  [/[a-z](?:bot|spider|crawler)\//i, "bot"],
  // Standalone words only: real phones ship UAs like "CUBOT_X30" or "CUBOT KINGKONG".
  [/(?:^|[^a-z])(?:bot|spider|crawler|crawl)(?:[^a-z]|$)/i, "bot"],
  // Crawlers announce themselves with a contact URL: "(+http://example.com/bot.html)".
  [/\+https?:\/\//i, "bot"],
];

/** Returns a short label when the user agent looks automated (or is missing), else null. */
export function botUserAgent(ua: unknown): string | null {
  const s = (typeof ua === "string" ? ua : "").trim();
  if (!s) return "missing";
  for (const [re, label] of BOT_PATTERNS) if (re.test(s)) return label;
  return null;
}
