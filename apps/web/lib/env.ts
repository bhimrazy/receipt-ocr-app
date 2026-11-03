import "server-only";

/**
 * Centralized env parsing for auth + database configuration. Receipt
 * services read their own config through Effect `Config` in packages/core.
 */

export const isProduction = process.env.NODE_ENV === "production";

/**
 * Email/password sign-up needs a verified address in production, so nobody can squat someone
 * else's email. `AUTH_REQUIRE_EMAIL_VERIFICATION=false` turns it off for CI's e2e run, which has
 * no mailer; local dev has no mailer either, so it is off there by default.
 */
export const requireEmailVerification =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === undefined
    ? isProduction
    : process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false";
/** `next build` runs with NODE_ENV=production but without runtime secrets. */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface SocialProviderEnv {
  clientId: string;
  clientSecret: string;
}

function socialProvider(prefix: "GOOGLE" | "GITHUB"): SocialProviderEnv | undefined {
  const clientId = optional(`${prefix}_CLIENT_ID`);
  const clientSecret = optional(`${prefix}_CLIENT_SECRET`);
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new Error(
      `Incomplete ${prefix} OAuth config: set both ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET (or neither).`,
    );
  }
  return { clientId, clientSecret };
}

/**
 * Comma-separated list of emails that are granted the `admin` role on sign-up.
 * Lowercased + de-duplicated. Used to bootstrap the first admin (see auth.ts).
 */
function adminEmailList(): string[] {
  const raw = optional("ADMIN_EMAILS");
  if (!raw) return [];
  const emails = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

export const emailEnv = {
  /** Resend API key. Without it, mail is logged instead of sent. */
  resendApiKey: optional("RESEND_API_KEY"),
  /** Verified sender, e.g. `receiptOCR <noreply@yourdomain.com>`. */
  from: optional("EMAIL_FROM"),
};

export const emailEnabled = Boolean(emailEnv.resendApiKey && emailEnv.from);

function betterAuthUrl(): string {
  const url = optional("BETTER_AUTH_URL");
  if (url) return url;
  // Localhost in production means broken invite links, a trustedOrigins
  // mismatch and non-Secure cookies; fail at startup instead.
  if (isProduction && !isBuild && optional("DATABASE_URL")) {
    throw new Error("BETTER_AUTH_URL must be set in production.");
  }
  return "http://localhost:3000";
}

/**
 * Headers that carry the client IP, comma-separated, e.g. `x-forwarded-for`.
 * Only set this behind a proxy that overwrites them: otherwise clients can
 * spoof the header and dodge rate limits. On Vercel the platform sets
 * x-forwarded-for, so it is the default there.
 */
function trustedIpHeaders(): string[] {
  const raw = process.env.TRUSTED_IP_HEADERS;
  if (raw === undefined) return process.env.VERCEL ? ["x-forwarded-for"] : [];
  return raw
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

export const authEnv = {
  /** Supabase transaction-pooler (port 6543) URL works here; postgres-js runs with prepare:false. */
  databaseUrl: optional("DATABASE_URL"),
  /** Min 32 chars. Generate with `openssl rand -base64 32`. */
  betterAuthSecret: optional("BETTER_AUTH_SECRET"),
  /** Canonical app origin, e.g. https://receiptocr.example.com. Defaults to localhost in dev. */
  betterAuthUrl: betterAuthUrl(),
  trustedIpHeaders: trustedIpHeaders(),
  /** Emails auto-promoted to the `admin` role when they sign up. */
  adminEmails: adminEmailList(),
  google: socialProvider("GOOGLE"),
  github: socialProvider("GITHUB"),
};

/**
 * Auth requires a database and a signing secret. When either is missing the
 * app degrades gracefully: auth endpoints return 503 and the sign-in/up pages
 * render a "not configured" card instead of crashing.
 */
export const authEnabled = Boolean(authEnv.databaseUrl && authEnv.betterAuthSecret);

if (authEnv.betterAuthSecret && authEnv.betterAuthSecret.length < 32) {
  console.warn(
    "BETTER_AUTH_SECRET is shorter than 32 characters; generate a stronger one with `openssl rand -base64 32`.",
  );
}

// Misconfigurations that fail open quietly; say so once at startup.
if (isProduction && authEnabled && !process.env.VERCEL && authEnv.trustedIpHeaders.length === 0) {
  console.warn(
    "TRUSTED_IP_HEADERS is unset: auth rate limits share one bucket for every client, so a few bad sign-ins lock everyone out. Set it to the header your proxy overwrites (e.g. x-forwarded-for).",
  );
}
if (isProduction && !requireEmailVerification) {
  console.warn(
    "AUTH_REQUIRE_EMAIL_VERIFICATION=false in production: anyone can register an address they don't own.",
  );
}
