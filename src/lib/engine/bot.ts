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
  [/bot|spider|crawl/i, "bot"],
];

/** Returns a short label when the user agent looks automated (or is missing), else null. */
export function botUserAgent(ua: string | undefined | null): string | null {
  const s = (ua ?? "").trim();
  if (!s) return "missing";
  for (const [re, label] of BOT_PATTERNS) if (re.test(s)) return label;
  return null;
}
