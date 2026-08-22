/**
 * Centralized, server-only env parsing for auth + database configuration.
 * Read env through this module instead of scattering `process.env` lookups.
 */

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

export const authEnv = {
  /** Supabase transaction-pooler (port 6543) URL works here; postgres-js runs with prepare:false. */
  databaseUrl: optional("DATABASE_URL"),
  /** Min 32 chars. Generate with `openssl rand -base64 32`. */
  betterAuthSecret: optional("BETTER_AUTH_SECRET"),
  /** Canonical app origin, e.g. https://receiptocr.example.com. Defaults to localhost in dev. */
  betterAuthUrl: optional("BETTER_AUTH_URL") ?? "http://localhost:3000",
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
