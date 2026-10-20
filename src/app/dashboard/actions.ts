"use server";
import { revalidatePath } from "next/cache";
import { keyNameSchema, parseSettings, type SettingsParse } from "@/components/dashboard/schemas";
import { generateKey } from "@/lib/keys";
import { getCurrentProject } from "@/lib/session";
import { getStore } from "@/lib/store";

const MAX_ACTIVE_KEYS = 20;

export type CreateKeyState = { error?: string; plaintext?: string; name?: string } | null;
export type SettingsState =
  | { saved?: boolean; errors?: Record<string, string>; message?: string; values?: Record<string, string> }
  | null;

export async function createKeyAction(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  const parsed = keyNameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };
  try {
    const project = await getCurrentProject();
    const store = getStore();
    const active = (await store.listKeys(project.id)).filter((k) => !k.revoked_at).length;
    if (active >= MAX_ACTIVE_KEYS) return { error: `You can have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` };
    const { plaintext, key } = generateKey(project.id, parsed.data);
    await store.insertKey(key);
    revalidatePath("/dashboard/keys");
    return { plaintext, name: key.name };
  } catch {
    return { error: "Could not create the key. Try again." };
  }
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const keyId = String(formData.get("keyId") ?? "");
  if (!keyId) return;
  const project = await getCurrentProject();
  // The store scopes the revoke to this project, so a forged keyId from another project does nothing.
  await getStore().revokeKey(project.id, keyId);
  revalidatePath("/dashboard/keys");
}

export async function updateSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const raw = Object.fromEntries(["name", "creditDollars", "challenge", "block"].map((k) => [k, String(formData.get(k) ?? "")]));
  const parsed: SettingsParse = parseSettings(raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };
  try {
    const project = await getCurrentProject();
    await getStore().updateProject(project.id, parsed.values);
    revalidatePath("/dashboard", "layout");
    return { saved: true, values: raw };
  } catch {
    return { message: "Could not save settings. Try again.", values: raw };
  }
}
