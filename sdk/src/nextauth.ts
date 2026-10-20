import type { CheckResult, Gatekeep } from "./types";

/** Minimal slice of the Auth.js `signIn` callback params. */
export interface SignInParams {
  user: { email?: string | null; name?: string | null };
  account?: { provider?: string } | null;
  /** True on the first email-provider request (before the magic link is sent). */
  email?: { verificationRequest?: boolean } | null;
  [key: string]: unknown;
}

export interface WithGatekeepOptions {
  gatekeep: Gatekeep;
  /** Where blocked users go. Return value `false` shows Auth.js's AccessDenied page. Default: false. */
  blockRedirect?: string | false;
  /** Where challenged users go, e.g. "/verify". Default: allow the sign in. */
  challengeRedirect?: string;
  /**
   * Run for credentials sign-ins too. Default false (OAuth and email only), because credentials
   * sign-ins are usually returning users.
   */
  includeCredentials?: boolean;
  /** Only check users who have never signed in. Return true if the user already exists. */
  isExistingUser?: (email: string) => boolean | Promise<boolean>;
  /** Request headers for ip/user agent, if you have them (e.g. from next/headers). */
  getRequestInfo?: () => { ip?: string; userAgent?: string; deviceId?: string } | Promise<{ ip?: string; userAgent?: string; deviceId?: string }>;
  onDecision?: (result: CheckResult, params: SignInParams) => void;
}

type SignInReturn = boolean | string;

/**
 * Wrap your Auth.js `signIn` callback. Returns `false` (AccessDenied) or a redirect URL for blocked and
 * challenged users, and whatever `inner` returns (default `true`) for allowed ones. Never throws from gatekeep.
 */
export function withGatekeep<P extends SignInParams = SignInParams>(
  opts: WithGatekeepOptions,
  inner?: (params: P) => SignInReturn | Promise<SignInReturn>,
): (params: P) => Promise<SignInReturn> {
  return async (params) => {
    const email = params.user?.email;
    const provider = params.account?.provider;
    const skip = !email || (provider === "credentials" && !opts.includeCredentials);
    // For the email provider, signIn runs twice; only check the request, not the click on the link.
    const emailClick = provider === "email" && !params.email?.verificationRequest;

    if (!skip && !emailClick) {
      try {
        if (!(await opts.isExistingUser?.(email))) {
          const info = (await opts.getRequestInfo?.()) ?? {};
          const result = await opts.gatekeep.check({
            email,
            ip: info.ip,
            user_agent: info.userAgent,
            device_id: info.deviceId,
            name: params.user.name ?? undefined,
          });
          opts.onDecision?.(result, params);
          if (result.decision === "block") return opts.blockRedirect ?? false;
          if (result.decision === "challenge" && opts.challengeRedirect) return opts.challengeRedirect;
        }
      } catch (e) {
        console.warn("[gatekeep] nextauth check failed open:", e instanceof Error ? e.message : e);
      }
    }
    return inner ? inner(params) : true;
  };
}
