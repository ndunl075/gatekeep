import type { CheckResult, Gatekeep } from "./types";

/** The slice of the Clerk backend client we use. Structural, so no @clerk dependency. */
export interface ClerkLike {
  users: {
    banUser(userId: string): Promise<unknown>;
    deleteUser(userId: string): Promise<unknown>;
    updateUserMetadata(userId: string, params: { publicMetadata?: Record<string, unknown> }): Promise<unknown>;
  };
}

/** The parts of a Clerk `user.created` webhook event we read. */
export interface ClerkUserCreatedEvent {
  type?: string;
  data: {
    id: string;
    email_addresses?: { id?: string; email_address: string }[];
    primary_email_address_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
}

export interface HandleClerkUserCreatedOptions {
  gatekeep: Gatekeep;
  clerk: ClerkLike;
  event: ClerkUserCreatedEvent;
  /** Client IP, if you captured it (Clerk webhooks do not include it). */
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  /** On block, delete the user instead of banning. Default false (ban). */
  deleteOnBlock?: boolean;
}

export interface HandleClerkResult {
  action: "none" | "banned" | "deleted" | "flagged";
  result: CheckResult | null;
}

/** Call from your verified `user.created` webhook route. Never throws. */
export async function handleClerkUserCreated(o: HandleClerkUserCreatedOptions): Promise<HandleClerkResult> {
  const { data } = o.event;
  const emails = data.email_addresses ?? [];
  const primary = emails.find((e) => e.id === data.primary_email_address_id) ?? emails[0];
  if (!primary) return { action: "none", result: null };

  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
  const result = await o.gatekeep.check({
    email: primary.email_address,
    ip: o.ip,
    user_agent: o.userAgent,
    device_id: o.deviceId,
    name,
  });

  try {
    if (result.decision === "block") {
      if (o.deleteOnBlock) {
        await o.clerk.users.deleteUser(data.id);
        return { action: "deleted", result };
      }
      await o.clerk.users.banUser(data.id);
      return { action: "banned", result };
    }
    if (result.decision === "challenge") {
      await o.clerk.users.updateUserMetadata(data.id, { publicMetadata: { gatekeep: "challenge" } });
      return { action: "flagged", result };
    }
  } catch (e) {
    console.warn("[gatekeep] could not apply decision in Clerk:", e instanceof Error ? e.message : e);
  }
  return { action: "none", result };
}
