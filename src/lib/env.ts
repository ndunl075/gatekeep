// Feature detection. Every integration is optional so the app runs (in demo mode) with zero config.

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  stripeSecret: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  stripePriceScale: process.env.STRIPE_PRICE_SCALE ?? "",
};

export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseAnonKey && env.supabaseServiceKey);
export const hasUpstash = () => Boolean(env.upstashUrl && env.upstashToken);
export const hasStripe = () => Boolean(env.stripeSecret);

/**
 * Demo mode: no Supabase, so the dashboard shows seeded data and needs no login.
 * In production it must be switched on explicitly (GATEKEEP_DEMO=1), so a deploy with a missing
 * Supabase variable never silently serves an unauthenticated dashboard.
 */
export const isDemoMode = () =>
  !hasSupabase() && (process.env.NODE_ENV !== "production" || process.env.GATEKEEP_DEMO === "1");

/** Production without Supabase and without GATEKEEP_DEMO=1: data features refuse to run. */
export const isMisconfigured = () => !hasSupabase() && !isDemoMode();
