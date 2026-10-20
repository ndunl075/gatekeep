// Email syntax validation and provider-aware normalization. Pure, no I/O.

export interface NormalizedEmail {
  /** `local@domain` after alias stripping, lowercased. Used as the dedupe key. */
  normalized: string;
  domain: string;
  local: string;
  plusAlias: boolean;
  dotAlias: boolean;
}

/** Normalization plus the pieces the engine needs for scoring (not part of the public contract). */
export interface ParsedEmail extends NormalizedEmail {
  /** Local part as typed (lowercased), with the +tag stripped but dots kept: used for gibberish checks. */
  displayLocal: string;
}

const MAX_EMAIL = 254;
const MAX_LOCAL = 64;
const MAX_DOMAIN = 253;
const MAX_LABEL = 63;

// RFC 5322 "atext" plus Unicode letters/digits (RFC 6531). Quoted local parts are intentionally unsupported.
const LOCAL_RE = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u;
const LABEL_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/** Providers where `user+tag@` delivers to `user@`. */
const PLUS_DOMAINS = new Set([
  "outlook.com", "outlook.fr", "outlook.de", "outlook.es", "outlook.it", "outlook.co.uk",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es",
  "live.com", "live.co.uk", "live.fr", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me",
  "fastmail.com", "fastmail.fm",
]);

/** Yahoo "disposable address" style aliases use `user-keyword@`. */
const YAHOO_DOMAINS = new Set([
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.ca", "yahoo.com.au", "yahoo.it", "yahoo.es",
  "ymail.com", "rocketmail.com",
]);

function validDomain(domain: string): boolean {
  if (domain.length < 4 || domain.length > MAX_DOMAIN) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL || !LABEL_RE.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  // TLDs are never purely numeric (rules out IPv4 literals like 1.2.3.4) and are at least 2 characters.
  return tld.length >= 2 && !/^\p{N}+$/u.test(tld);
}

export function parseEmail(email: string): ParsedEmail | null {
  if (typeof email !== "string") return null;
  const raw = email.trim().normalize("NFC").toLowerCase();
  if (raw.length === 0 || raw.length > MAX_EMAIL) return null;
  const at = raw.lastIndexOf("@");
  if (at < 1 || at === raw.length - 1) return null;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);
  if (local.length > MAX_LOCAL || local.includes("@") || !LOCAL_RE.test(local) || !validDomain(domain)) return null;

  let plusAlias = false;
  let dotAlias = false;
  if (GMAIL.has(domain)) {
    domain = "gmail.com";
    const plus = local.indexOf("+");
    if (plus !== -1) {
      local = local.slice(0, plus);
      plusAlias = true;
    }
    const displayLocal = local;
    if (local.includes(".")) {
      dotAlias = true;
      local = local.replaceAll(".", "");
    }
    if (!local) return null;
    return { normalized: `${local}@${domain}`, domain, local, plusAlias, dotAlias, displayLocal };
  }
  if (PLUS_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus !== -1) {
      local = local.slice(0, plus);
      plusAlias = true;
    }
  } else if (YAHOO_DOMAINS.has(domain)) {
    const dash = local.indexOf("-");
    if (dash !== -1) {
      local = local.slice(0, dash);
      plusAlias = true;
    }
  }
  if (!local) return null;
  return { normalized: `${local}@${domain}`, domain, local, plusAlias, dotAlias, displayLocal: local };
}

/** Returns null for invalid syntax. See docs/architecture.md for the alias rules. */
export function normalizeEmail(email: string): NormalizedEmail | null {
  const p = parseEmail(email);
  if (!p) return null;
  const { displayLocal: _displayLocal, ...pub } = p;
  void _displayLocal;
  return pub;
}
