// Deterministic demo data so the dashboard and landing page look alive without a database.
import type { CheckLog, Decision, Signal } from "./types";
import { MemoryStore, defaultProject } from "./store/memory";
import { hashKey } from "./keys";

export const DEMO_OWNER_ID = "demo-owner";
export const DEMO_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
/** Works against the demo store's /api/v1/check. Publicly documented; it only ever touches demo data. */
export const DEMO_API_KEY = "gk_live_demo_key_for_the_playground_only";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const FIRST = [
  "maya",
  "dana",
  "luis",
  "priya",
  "omar",
  "sofia",
  "kenji",
  "amara",
  "noah",
  "lena",
  "ravi",
  "ines",
  "theo",
  "zara",
  "felix",
];
const LAST = [
  "chen",
  "okafor",
  "silva",
  "patel",
  "haddad",
  "rossi",
  "tanaka",
  "mensah",
  "berg",
  "kowal",
  "iyer",
  "costa",
  "nguyen",
  "ali",
];
const GOOD_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "northwind.io",
  "hey.com",
  "fastmail.com",
];
const TEMP = [
  "mailinator.com",
  "temp-mail.org",
  "guerrillamail.com",
  "10minutemail.com",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com",
];

interface Template {
  decision: Decision;
  make: (
    r: () => number,
    i: number,
  ) => { email: string; signals: Signal[]; ip: string; ua?: string };
}

const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const ip = (r: () => number) =>
  `${Math.floor(r() * 200) + 20}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${Math.floor(r() * 254) + 1}`;

const TEMPLATES: { weight: number; t: Template }[] = [
  {
    weight: 62,
    t: {
      decision: "allow",
      make: (r) => ({
        email: `${pick(r, FIRST)}.${pick(r, LAST)}@${pick(r, GOOD_DOMAINS)}`,
        signals: [],
        ip: ip(r),
      }),
    },
  },
  {
    weight: 14,
    t: {
      decision: "block",
      make: (r) => {
        const d = pick(r, TEMP);
        return {
          email: `${pick(r, FIRST)}${Math.floor(r() * 999)}@${d}`,
          ip: ip(r),
          signals: [
            {
              id: "disposable_domain",
              points: 80,
              detail: `${d} is a disposable email provider`,
            },
          ],
        };
      },
    },
  },
  {
    weight: 9,
    t: {
      decision: "challenge",
      make: (r, i) => ({
        email: `n.ico+${(i % 40) + 2}@gmail.com`,
        ip: ip(r),
        signals: [
          {
            id: "plus_alias",
            points: 10,
            detail: "Uses a +alias of n.ico@gmail.com",
          },
          {
            id: "dot_alias",
            points: 10,
            detail: "Dots in a Gmail address are ignored by Gmail",
          },
          {
            id: "email_reuse",
            points: 35,
            detail: "nico@gmail.com already signed up 4 times",
          },
        ],
      }),
    },
  },
  {
    weight: 8,
    t: {
      decision: "block",
      make: (r, i) => ({
        email: `${pick(r, FIRST)}${i}@${pick(r, GOOD_DOMAINS)}`,
        ip: "185.220.101.7",
        signals: [
          {
            id: "ip_velocity",
            points: 60,
            detail: "6 signups from 185.220.101.7 in 24h",
          },
          {
            id: "signup_burst",
            points: 25,
            detail: "41 signups in the last 10 minutes, 9x normal",
          },
        ],
      }),
    },
  },
  {
    weight: 4,
    t: {
      decision: "challenge",
      make: (r) => ({
        email: `xkqzvbt${Math.floor(r() * 99)}@outlook.com`,
        ip: ip(r),
        signals: [
          {
            id: "gibberish_email",
            points: 25,
            detail: "Email looks machine generated",
          },
          {
            id: "bot_user_agent",
            points: 30,
            detail: "User agent is python-requests",
          },
        ],
        ua: "python-requests/2.32.3",
      }),
    },
  },
  {
    weight: 3,
    t: {
      decision: "block",
      make: (r) => ({
        email: `${pick(r, FIRST)}@nomx-${Math.floor(r() * 99)}.xyz`,
        ip: ip(r),
        signals: [
          { id: "no_mx", points: 70, detail: "Domain has no mail servers" },
        ],
      }),
    },
  },
];

function pickTemplate(r: () => number): Template {
  const total = TEMPLATES.reduce((s, x) => s + x.weight, 0);
  let n = r() * total;
  for (const x of TEMPLATES) {
    if ((n -= x.weight) < 0) return x.t;
  }
  return TEMPLATES[0].t;
}

const UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
];

// Simplified gmail normalization for demo rows (the engine has the real one).
function demoNormalize(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  if (domain !== "gmail.com") return `${local.split("+")[0]}@${domain}`;
  return `${local.split("+")[0].replace(/\./g, "")}@${domain}`;
}

export function generateDemoChecks(
  projectId: string,
  days = 30,
  now = Date.now(),
): CheckLog[] {
  const r = rng(42);
  const out: CheckLog[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000 - d * 86_400_000;
    const weekday = new Date(dayStart).getUTCDay();
    const volume = Math.floor(
      70 +
        r() * 50 +
        (weekday === 0 || weekday === 6 ? -20 : 10) +
        (days - d) * 1.5,
    );
    const span = d === 0 ? Math.max(1, now - dayStart) : 86_400_000;
    for (let i = 0; i < volume; i++) {
      const t = pickTemplate(r);
      const { email, signals, ip, ua } = t.make(r, i);
      const score =
        t.decision === "allow"
          ? Math.floor(r() * 18)
          : Math.min(
              100,
              signals.reduce((s, x) => s + x.points, 0) + Math.floor(r() * 8),
            );
      const at = new Date(dayStart + Math.floor(r() * span));
      out.push({
        id: crypto.randomUUID(),
        project_id: projectId,
        created_at: at.toISOString(),
        email,
        normalized_email: demoNormalize(email),
        email_domain: email.split("@")[1],
        ip,
        user_agent: ua ?? pick(r, UAS),
        device_id: null,
        decision: t.decision,
        score,
        reason: signals.length
          ? signals.map((s) => s.detail).join("; ")
          : "No risk signals",
        signals,
        latency_ms: 18 + Math.floor(r() * 60),
      });
    }
  }
  return out;
}

export function createDemoStore(): MemoryStore {
  const store = new MemoryStore();
  const project = {
    ...defaultProject(DEMO_OWNER_ID, "Acme AI", DEMO_PROJECT_ID),
    plan: "pro" as const,
  };
  store.projects.set(project.id, project);
  store.keys.set("demo-key", {
    id: "demo-key",
    project_id: project.id,
    name: "Playground",
    prefix: DEMO_API_KEY.slice(0, 12),
    key_hash: hashKey(DEMO_API_KEY),
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
  });
  store.checks = generateDemoChecks(project.id);
  return store;
}
