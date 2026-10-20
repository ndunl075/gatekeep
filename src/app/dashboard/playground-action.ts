"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runCheckForProject } from "@/lib/check-service";
import { getCurrentProject } from "@/lib/session";
import type { CheckResult } from "@/lib/types";

const schema = z.object({
  email: z.string().trim().min(1, "Enter an email address").max(320),
  ip: z.string().trim().max(64).optional(),
  user_agent: z.string().max(1024).optional(),
  device_id: z.string().trim().max(128).optional(),
  name: z.string().trim().max(200).optional(),
  dryRun: z.boolean().optional(),
});

export type PlaygroundInput = z.input<typeof schema>;
export type PlaygroundState = { ok: true; result: CheckResult; dryRun: boolean } | { ok: false; error: string };

/** Runs a check against the signed-in user's own project. The project always comes from the session. */
export async function runPlaygroundCheck(input: PlaygroundInput): Promise<PlaygroundState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { dryRun = false, ...fields } = parsed.data;
  // Empty optional fields mean "not provided".
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== "")) as typeof fields;

  // Outside the try: a signed-out caller gets Next's redirect to /login.
  const project = await getCurrentProject();
  try {
    const result = await runCheckForProject(project, clean, { dryRun });
    if (!dryRun) {
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/checks");
    }
    return { ok: true, result, dryRun };
  } catch {
    return { ok: false, error: "Could not run the check. Try again." };
  }
}
