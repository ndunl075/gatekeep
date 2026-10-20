import { createHash, randomBytes } from "node:crypto";
import type { ApiKey } from "./types";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Creates a new secret key. The plaintext is returned once and must be shown to the user, never stored. */
export function generateKey(projectId: string, name: string): { plaintext: string; key: ApiKey } {
  // Rejection sampling keeps every character uniform (248 = 4 * 62).
  let body = "";
  while (body.length < 40) {
    for (const b of randomBytes(48)) {
      if (b < 248 && body.length < 40) body += ALPHABET[b % ALPHABET.length];
    }
  }
  const plaintext = `gk_live_${body}`;
  return {
    plaintext,
    key: {
      id: crypto.randomUUID(),
      project_id: projectId,
      name,
      prefix: plaintext.slice(0, 12),
      key_hash: hashKey(plaintext),
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    },
  };
}

/** Pulls the key from `Authorization: Bearer gk_...` or `x-api-key`. */
export function readKeyFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return headers.get("x-api-key")?.trim() || null;
}
