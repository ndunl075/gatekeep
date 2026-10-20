// Heuristics for keyboard mash / machine-generated strings. Tuned to prefer false negatives: a real person
// being challenged is worse than a bot slipping past one weak signal. Only Latin-script tokens are judged;
// anything else (CJK, Cyrillic, ...) is never flagged.

const FOLD: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", ł: "l", þ: "th", ı: "i" };

/** Lowercase, strip diacritics, transliterate a few Latin letters. Returns null if non a-z letters remain. */
function fold(token: string): string | null {
  const s = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[øæœßđðłþı]/g, (c) => FOLD[c]);
  return /^[a-z]+$/.test(s) ? s : null;
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
// Column sweeps and spirals people type when they just want a "password-looking" string.
const KEY_PATTERNS = ["qazwsxedcrfvtgbyhnujm", "plmokn", "zaqxsw"];
const KEY_STRINGS = [...KEY_ROWS, ...KEY_PATTERNS].flatMap((r) => [r, [...r].reverse().join("")]);
// QWERTZ/AZERTY differ from QWERTY by one letter, so a 5-run also matches real names (Wertz, Wertzberger).
// Only count them from 6 letters up.
const KEY_STRINGS_LOCALE = ["qwertzuiop", "azertyuiop"].flatMap((r) => [r, [...r].reverse().join("")]);

/** Longest substring of `s` that is a contiguous run along a keyboard row/column pattern. */
function longestKeyboardRun(s: string, strings: string[] = KEY_STRINGS): number {
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    for (const row of strings) {
      let n = 0;
      const start = row.indexOf(s[i]);
      if (start === -1) continue;
      // extend while s keeps following the row; try every occurrence of the start char
      for (let at = start; at !== -1; at = row.indexOf(s[i], at + 1)) {
        n = 0;
        while (i + n < s.length && at + n < row.length && s[i + n] === row[at + n]) n++;
        if (n > best) best = n;
      }
    }
  }
  return best;
}

/** Run length that counts as keyboard mash, across all layouts. */
function keyboardMash(s: string, min = 5): boolean {
  return longestKeyboardRun(s) >= min || longestKeyboardRun(s, KEY_STRINGS_LOCALE) >= 6;
}

const VOWELS = new Set("aeiouy");

/** Consonant-consonant pairs seen in names and words from many languages. Any pair with a vowel is plausible. */
const CC_OK = new Set(
  (
    "bd bh bj bl br bs bt bw " +
    "cc ch ck cl cq cr cs ct cz " +
    "dd dg dh dj dl dm dn dr ds dt dv dw dz " +
    "ff fl fr fs ft " +
    "gb gd gg gh gl gm gn gr gs gw " +
    "hh hl hm hn hr hs ht hw " +
    "jh jj jr " +
    "kh kj kk kl km kn kp kr ks kt kv kw " +
    "lb lc ld lf lg lh lj lk ll lm lp ls lt lv lw lz " +
    "mb mc md mf mg mh mj mk ml mm mn mp mr ms mt mv mw mz " +
    "nb nc nd nf ng nh nj nk nl nm nn np nr ns nt nv nw nz " +
    "pf ph pl pn pp pr ps pt pw " +
    "rb rc rd rf rg rh rj rk rl rm rn rp rr rs rt rv rw rz " +
    "sc sh sj sk sl sm sn sp sq sr ss st sv sw sz " +
    "tc th tj tl tm tr ts tt tv tw tz " +
    "vl vn vr vs vv " +
    "wh wl wn wr ws wt ww wz " +
    "xc xh xp xs xt xx " +
    "zb zd zg zh zl zm zn zr zs zt zv zw zz"
  ).split(" "),
);

function implausibleBigramRatio(s: string): number {
  let bad = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (VOWELS.has(a) || VOWELS.has(b)) continue;
    if (!CC_OK.has(a + b)) bad++;
  }
  return bad / (s.length - 1);
}

function longestConsonantRun(s: string): number {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = VOWELS.has(c) ? 0 : run + 1;
    if (run > best) best = run;
  }
  return best;
}

function isRepeatedUnit(s: string): boolean {
  for (let len = 2; len <= 4; len++) {
    if (s.length % len !== 0 || s.length / len < 2) continue;
    if (s.slice(0, len).repeat(s.length / len) === s) return true;
  }
  return false;
}

/** Is a single folded a-z token (>= 5 letters) machine-looking? */
function tokenIsGibberish(s: string): boolean {
  const n = s.length;
  if (n < 5) return false;
  if (new Set(s).size <= 2 && n >= 8) return true; // ababababab (aaaaaa is caught below)
  if (/(.)\1{3,}/.test(s)) return true; // fffff
  if (![...s].some((c) => VOWELS.has(c))) return true; // xkqzvbt
  if (longestConsonantRun(s) >= 6) return true; // jfkdlsa
  if (keyboardMash(s)) return true; // asdfg, qwerty
  // Doubled units only count with keyboard evidence: Nhlanhla and Kalikali are real names.
  if (n >= 6 && isRepeatedUnit(s) && longestKeyboardRun(s) >= 3) return true; // qweqwe
  // All home-row letters with at most one "a": asdkjh, jfkdlsa.
  if (n >= 6 && /^[asdfghjkl]+$/.test(s) && [...s].filter((c) => c === "a").length <= 1) return true;
  if (n >= 6 && implausibleBigramRatio(s) >= 0.5) return true;
  return false;
}

/** Keyboard-row check that ignores separators and digits so `1qaz2wsx` and `as.df.gh` are caught. */
function joinedKeyboardMash(local: string): boolean {
  const letters = local.toLowerCase().replace(/[^a-z]/g, "");
  return letters.length >= 5 && keyboardMash(letters);
}

/** Letter/digit churn like `x7k2m9p4q1`, or a long digit tail on a short stem. */
function digitSoup(local: string): boolean {
  const s = local.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length < 8) return false;
  let transitions = 0;
  for (let i = 1; i < s.length; i++) if (/\d/.test(s[i]) !== /\d/.test(s[i - 1])) transitions++;
  if (transitions >= 5) return true;
  const digits = (s.match(/\d/g) ?? []).length;
  const longestRun = Math.max(0, ...(s.match(/\d+/g) ?? []).map((m) => m.length));
  return digits < s.length && longestRun >= 9 && digits / s.length >= 0.6;
}

/** True when the email local part (without +tag) looks machine generated. */
export function gibberishEmailLocal(local: string): boolean {
  if (joinedKeyboardMash(local)) return true;
  if (digitSoup(local)) return true;
  for (const part of local.split(/[^\p{L}]+/u)) {
    const folded = part ? fold(part) : null;
    if (folded && tokenIsGibberish(folded)) return true;
  }
  return false;
}

/** True when a free-text display name looks like keyboard mash. Judges each word separately. */
export function gibberishName(name: string): boolean {
  const words = name.split(/[\s\-_.,]+/u).filter(Boolean);
  if (words.length === 0) return false;
  for (const w of words) {
    const folded = fold(w);
    if (!folded) continue;
    if (tokenIsGibberish(folded)) return true;
    // Short whole-word keyboard runs: "asdf", "qwer".
    if (folded.length === 4 && longestKeyboardRun(folded) === 4 && /^(asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|zxcv|xcvb|cvbn|vbnm|uiop|tyui|rtyu)$/.test(folded)) return true;
  }
  return false;
}
