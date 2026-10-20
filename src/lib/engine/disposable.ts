import domains from "./data/disposable-domains.json";

// Built once per server instance. ~100k short strings: a few ms to build, a few MB of heap.
const DISPOSABLE = new Set<string>(domains as string[]);

/**
 * Returns the listed domain that matched `domain` (itself or the closest listed parent), or null.
 * `a.b.mailinator.com` matches `mailinator.com`. Never matches a bare TLD.
 */
export function matchDisposable(domain: string): string | null {
  let d = domain.toLowerCase();
  for (;;) {
    if (DISPOSABLE.has(d)) return d;
    const dot = d.indexOf(".");
    if (dot === -1) return null;
    d = d.slice(dot + 1);
    if (!d.includes(".")) return null;
  }
}

export function isDisposableDomain(domain: string): boolean {
  return matchDisposable(domain) !== null;
}

export const DISPOSABLE_COUNT = DISPOSABLE.size;
