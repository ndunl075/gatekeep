# Disposable domain list

`disposable-domains.json` is a sorted, lowercased, deduplicated JSON array of disposable / throwaway email
domains (about 98k; real consumer providers and shared dynamic-DNS suffixes are allowlisted in the update script). The engine loads it into a `Set` once per server instance and also matches parent domains
(`a.b.mailinator.com` matches `mailinator.com`).

Regenerate with `node scripts/update-disposable.mjs` (needs network). The script merges the sources below, removes
the allowlist baked into the script (Gmail, Outlook, Yahoo, iCloud, Proton, AOL, GMX, Yandex, ... never flagged),
and refuses to overwrite the file if fewer than 10k domains came back. Review the diff before committing.

## Sources and licenses

| Source | License |
|---|---|
| [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) `disposable_email_blocklist.conf` | CC0 1.0 |
| [disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains) `domains.txt` | MIT |
| [FGRibreau/mailchecker](https://github.com/FGRibreau/mailchecker) `list.txt` | MIT |
| [7c/fakefilter](https://github.com/7c/fakefilter) `json/data.json` | see upstream repository (no license file at time of generation; only domain names are used) |

The upstream allowlist file of disposable-email-domains was not reachable at generation time, so the allowlist
lives in `scripts/update-disposable.mjs`. Add providers there rather than editing the JSON by hand.
