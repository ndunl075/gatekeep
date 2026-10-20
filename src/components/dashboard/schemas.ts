// Server-side validation for dashboard forms. Pure, so it is unit-tested.
import { z } from "zod";

export const keyNameSchema = z.string().trim().min(1, "Give the key a name").max(60, "Keep it under 60 characters");

const num = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((s) => Number(s))
    .pipe(z.number({ error: `${label} must be a number` }).finite(`${label} must be a number`));

const settingsSchema = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(60, "Keep it under 60 characters"),
    creditDollars: num("Free credits").pipe(z.number().min(0, "Cannot be negative").max(10_000, "That seems too high")),
    challenge: num("Challenge threshold").pipe(z.number().int("Use a whole number").min(0, "Use 0-100").max(100, "Use 0-100")),
    block: num("Block threshold").pipe(z.number().int("Use a whole number").min(0, "Use 0-100").max(100, "Use 0-100")),
  })
  .refine((v) => v.challenge < v.block, { path: ["challenge"], message: "Challenge must be lower than block" });

export interface SettingsValues {
  name: string;
  credit_value_cents: number;
  challenge_threshold: number;
  block_threshold: number;
}

export type SettingsParse =
  | { ok: true; values: SettingsValues }
  | { ok: false; errors: Partial<Record<"name" | "creditDollars" | "challenge" | "block", string>> };

export function parseSettings(input: Record<string, unknown>): SettingsParse {
  const r = settingsSchema.safeParse({
    name: input.name ?? "",
    creditDollars: input.creditDollars ?? "",
    challenge: input.challenge ?? "",
    block: input.block ?? "",
  });
  if (r.success) {
    return {
      ok: true,
      values: {
        name: r.data.name,
        credit_value_cents: Math.round(r.data.creditDollars * 100),
        challenge_threshold: r.data.challenge,
        block_threshold: r.data.block,
      },
    };
  }
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "name");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}
