#!/usr/bin/env node
// Regenerates src/lib/engine/data/disposable-domains.json from open-source lists.
// Usage: node scripts/update-disposable.mjs   (needs network; see src/lib/engine/data/README.md)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = "https://raw.githubusercontent.com";
const SOURCES = [
  { name: "disposable-email-domains", url: `${RAW}/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf`, parse: lines },
  { name: "disposable/disposable-email-domains", url: `${RAW}/disposable/disposable-email-domains/master/domains.txt`, parse: lines },
  { name: "mailchecker", url: `${RAW}/FGRibreau/mailchecker/master/list.txt`, parse: lines },
  { name: "fakefilter", url: `${RAW}/7c/fakefilter/main/json/data.json`, parse: fakefilter },
];
// The upstream allowlist moves around, so the one we apply is kept here: well-known legitimate providers
// that must never be flagged even if a source lists them by mistake.
const ALLOW = new Set(`
gmail.com googlemail.com outlook.com hotmail.com live.com msn.com yahoo.com ymail.com rocketmail.com icloud.com me.com mac.com
proton.me protonmail.com pm.me aol.com zoho.com zohomail.com fastmail.com fastmail.fm hey.com tutanota.com tuta.io tutamail.com
gmx.com gmx.net gmx.de gmx.at gmx.ch gmx.co.uk gmx.us gmx.fr gmx.es gmx.org mail.com email.com web.de t-online.de freenet.de
yandex.com yandex.ru mail.ru bk.ru inbox.ru list.ru rambler.ru qq.com 163.com 126.com sina.com sohu.com naver.com daum.net hanmail.net
comcast.net verizon.net att.net sbcglobal.net bellsouth.net cox.net charter.net earthlink.net optonline.net btinternet.com
orange.fr free.fr wanadoo.fr laposte.net sfr.fr libero.it virgilio.it tiscali.it seznam.cz wp.pl o2.pl interia.pl onet.pl
rediffmail.com shaw.ca rogers.com sympatico.ca bigpond.com telus.net
21cn.com tom.com 123.com 158.com mail.by sina.cn yeah.net aliyun.com 139.com 189.cn foxmail.com nate.com yahoo.co.jp
protonmail.ch tutanota.de keemail.me mailbox.org posteo.de posteo.net runbox.com hushmail.com startmail.com
duck.com simplelogin.com simplelogin.co anonaddy.com anonaddy.me privaterelay.appleid.com ukr.net i.ua abv.bg
centrum.cz email.cz post.cz onet.pl op.pl poczta.fm tlen.pl
`.split(/\s+/).filter(Boolean));

// Shared dynamic-DNS / free-subdomain suffixes. The engine matches parent domains, so listing one of these
// would flag every host under it (including real companies' mail servers). Never list them.
const ALLOW_PARENTS = new Set(`
ddns.net hopto.org dyndns.org no-ip.org no-ip.com duckdns.org myftp.org zapto.org servebeer.com serveftp.com
sytes.net hopto.me dynu.net ddnsking.com 3utilities.com bounceme.net redirectme.net mooo.com
`.split(/\s+/).filter(Boolean));

function lines(text) {
  return text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
}
function fakefilter(text) {
  return Object.keys(JSON.parse(text).domains ?? {});
}
function clean(d) {
  const x = d.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(x) || /^xn--/.test(x) ? x : null;
}

const all = new Set();
for (const s of SOURCES) {
  try {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let n = 0;
    for (const raw of s.parse(await res.text())) {
      const d = clean(raw);
      if (d) {
        all.add(d);
        n++;
      }
    }
    console.log(`${s.name}: ${n}`);
  } catch (e) {
    console.error(`${s.name}: skipped (${e.message})`);
  }
}
for (const a of [...ALLOW, ...ALLOW_PARENTS]) all.delete(a);
if (all.size < 10_000) {
  console.error(`only ${all.size} domains collected; refusing to overwrite the bundled list`);
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/engine/data/disposable-domains.json");
writeFileSync(out, JSON.stringify([...all].sort()) + "\n");
console.log(`wrote ${all.size} domains to ${out}`);
