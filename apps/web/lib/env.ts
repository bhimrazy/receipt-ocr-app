import "server-only";
import { isIP } from "node:net";
import { isEmailAddress } from "@receipt-ocr/email";

/**
 * Centralized env parsing for auth + database configuration. Receipt
 * services read their own config through Effect `Config` in packages/core.
 */

export const isProduction = process.env.NODE_ENV === "production";

/**
 * Whether an undelivered email (no mailer) may be logged in full, link included. Development
 * only: those links are credentials. A deployed Vercel environment never qualifies, even with a
 * mis-set NODE_ENV.
 */
export const logUndeliveredMail = (env: Record<string, string | undefined> = process.env) =>
  env.NODE_ENV !== "production" &&
  env.NODE_ENV === "development" &&
  env.VERCEL_ENV !== "production" &&
  env.VERCEL_ENV !== "preview";

/**
 * Email/password sign-up needs a verified address in production, so nobody can squat someone
 * else's email. `AUTH_REQUIRE_EMAIL_VERIFICATION=false` turns it off for CI's e2e run, which has
 * no mailer; local dev has no mailer either, so it is off there by default.
 */
export const requireEmailVerification =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === undefined
    ? isProduction
    : process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false";
/**
 * Platform admins must have a second factor and prove it once per session (see
 * docs/plans/2026-11-06-passkeys-2fa.md). On in production and the production-mode e2e run;
 * `ADMIN_MFA_ENFORCE=false` is the emergency off switch, `=true` turns it on in development.
 */
export const adminMfaEnforced =
  process.env.ADMIN_MFA_ENFORCE === undefined
    ? isProduction
    : process.env.ADMIN_MFA_ENFORCE !== "false";

/**
 * `next build` runs with NODE_ENV=production but without runtime secrets: on Vercel they are stored
 * as Sensitive, so `vercel pull` in CI gets empty or placeholder values for them.
 */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

/**
 * Parses a runtime-only value. A malformed value throws when the server starts, but during the
 * build it is treated as unset (with a warning), so a placeholder never fails the build.
 */
function runtimeOnly<T>(name: string, parse: () => T, unset: T): T {
  try {
    return parse();
  } catch (error) {
    if (!isBuild) throw error;
    console.warn(`[env] ${name} is not valid at build time; treating it as unset for the build.`);
    return unset;
  }
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface SocialProviderEnv {
  clientId: string;
  clientSecret: string;
}

function socialProvider(prefix: "GOOGLE" | "GITHUB"): SocialProviderEnv | undefined {
  return runtimeOnly(
    `${prefix}_CLIENT_ID/${prefix}_CLIENT_SECRET`,
    () => parseSocialProvider(prefix),
    undefined,
  );
}

function parseSocialProvider(prefix: "GOOGLE" | "GITHUB"): SocialProviderEnv | undefined {
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

/**
 * SUPPORT_EMAIL goes into emails as a bare address, which the templates validate. A bad value
 * (e.g. "Support <help@x>") is treated as unset: otherwise every email would throw and Better
 * Auth would swallow the error.
 */
function supportAddress(): string | undefined {
  const value = optional("SUPPORT_EMAIL");
  if (value === undefined || isEmailAddress(value)) return value;
  if (!isBuild) {
    console.warn(
      "SUPPORT_EMAIL is not a bare address (e.g. help@example.com); treating it as unset.",
    );
  }
  return undefined;
}

const supportAddressValue = supportAddress();

export const emailEnv = {
  /** Resend API key. Without it, mail is logged instead of sent. */
  resendApiKey: optional("RESEND_API_KEY"),
  /** Verified sender, e.g. `receiptOCR <noreply@yourdomain.com>`. */
  from: optional("EMAIL_FROM"),
  /** Default Reply-To so answers to noreply mail reach the support inbox. */
  replyTo: supportAddressValue,
};

/**
 * Bearer secret for the queue drain route (`/api/jobs/drain`), sent by Vercel Cron and pg_net.
 * Read at call time. Optional: without it the route answers 401 and drains nothing.
 */
export const cronSecret = (env: Record<string, string | undefined> = process.env) =>
  env.CRON_SECRET?.trim() || undefined;

if (cronSecret() && cronSecret()!.length < 32 && !isBuild) {
  console.warn(
    "CRON_SECRET is shorter than 32 characters; generate a stronger one with `openssl rand -hex 32`.",
  );
}

/** Inbox for support-form messages. Unset means the form can't deliver. */
export const supportEmail = supportAddressValue;

export const emailEnabled = Boolean(emailEnv.resendApiKey && emailEnv.from);

/**
 * Vercel preview deployments only (VERCEL_ENV is "production" on the live site). Production never
 * reads VERCEL_URL: its origin is always the exact BETTER_AUTH_URL.
 */
const isVercelPreview = process.env.VERCEL_ENV === "preview";

/** The preview's hosts, branch alias first: `https://<branch alias>` and `https://<deployment>`. */
function previewOrigins(): string[] {
  if (!isVercelPreview) return [];
  const hosts = [optional("VERCEL_BRANCH_URL"), optional("VERCEL_URL")].filter(
    (host): host is string => Boolean(host),
  );
  return [...new Set(hosts.map((host) => `https://${host}`))];
}

function betterAuthUrl(): string {
  return runtimeOnly("BETTER_AUTH_URL", parseBetterAuthUrl, "http://localhost:3000");
}

function parseBetterAuthUrl(): string {
  const url = optional("BETTER_AUTH_URL");
  if (url) {
    if (!isUrl(url))
      throw new Error("BETTER_AUTH_URL must be an absolute URL, e.g. https://app.example.com.");
    return url;
  }
  // A preview has no fixed domain, so its own host is the app origin: sign-in works there and
  // email links point back at the preview, never at production.
  const preview = previewOrigins()[0];
  if (preview) return preview;
  // Localhost in production means broken invite links, a trustedOrigins
  // mismatch and non-Secure cookies; fail at startup instead.
  if (isProduction && !isBuild && optional("DATABASE_URL")) {
    throw new Error("BETTER_AUTH_URL must be set in production.");
  }
  return "http://localhost:3000";
}

const appUrl = betterAuthUrl();

/** What every message links back to: the app origin (BETTER_AUTH_URL) and the support inbox. */
export const emailContext = { appUrl, supportEmail };

/** The "didn't do this?" link in security notices. */
export const resetPasswordUrl = () => new URL("/forgot-password", appUrl).toString();

/** Origins allowed to call auth and mutating routes: the app URL, plus both hosts of a preview. */
const trustedOrigins = [...new Set([new URL(appUrl).origin, ...previewOrigins()])];

function list(name: string): string[] | undefined {
  const raw = optional(name);
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

/**
 * Headers that carry the client IP, comma-separated, e.g. `x-forwarded-for`.
 * Only set this behind a proxy that overwrites them, or that appends to them
 * and is listed in TRUSTED_PROXIES: otherwise clients can spoof the header and
 * dodge rate limits. On Vercel the platform sets x-forwarded-for, so it is the
 * default there. Never `[]`: Better Auth would then read no header at all.
 */
function trustedIpHeaders(): string[] | undefined {
  const headers = list("TRUSTED_IP_HEADERS")?.map((header) => header.toLowerCase());
  return headers ?? (process.env.VERCEL ? ["x-forwarded-for"] : undefined);
}

function isIpOrCidr(value: string): boolean {
  const [address = "", prefix, ...rest] = value.split("/");
  const family = isIP(address);
  if (!family || rest.length) return false;
  if (prefix === undefined) return true;
  return /^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * IPs or CIDR ranges of reverse proxies that append to the IP header, e.g.
 * `10.0.0.5,10.1.0.0/24`. The client IP is then the right-most hop not in this
 * list, instead of a single-value header.
 */
function trustedProxies(): string[] | undefined {
  return runtimeOnly("TRUSTED_PROXIES", parseTrustedProxies, undefined);
}

function parseTrustedProxies(): string[] | undefined {
  const proxies = list("TRUSTED_PROXIES");
  const invalid = proxies?.filter((proxy) => !isIpOrCidr(proxy));
  if (invalid?.length) {
    throw new Error(`TRUSTED_PROXIES has invalid IPs or CIDR ranges: ${invalid.join(", ")}`);
  }
  return proxies;
}

/**
 * `BETTER_AUTH_SECRETS=2:<new>,1:<old>`: versioned secrets, current first.
 * Older versions still decrypt stored OAuth tokens, so the secret can rotate
 * without losing them. Session cookies are signed with the current one only,
 * so rotating still signs everyone out.
 */
function betterAuthSecrets(): { version: number; value: string }[] | undefined {
  return runtimeOnly("BETTER_AUTH_SECRETS", parseBetterAuthSecrets, undefined);
}

function parseBetterAuthSecrets(): { version: number; value: string }[] | undefined {
  const entries = list("BETTER_AUTH_SECRETS");
  if (!entries) return undefined;
  const secrets = entries.map((entry) => {
    const colon = entry.indexOf(":");
    const version = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    if (colon === -1 || !/^\d+$/.test(version) || !value) {
      throw new Error('BETTER_AUTH_SECRETS entries must look like "<version>:<secret>".');
    }
    return { version: Number(version), value };
  });
  if (new Set(secrets.map((s) => s.version)).size !== secrets.length) {
    throw new Error("BETTER_AUTH_SECRETS has a duplicate version.");
  }
  return secrets;
}

/**
 * Cloudflare Turnstile bot protection, on only when both keys are set. The site key is public and
 * inlined into the client bundle at build time (NEXT_PUBLIC_*); the secret key stays on the server.
 * One without the other would either show a widget nothing checks or reject every form, so that
 * fails at startup (not during `next build`, which runs without runtime secrets).
 * TURNSTILE_ALLOWED_HOSTNAMES (comma-separated) overrides the hostname siteverify must report; it
 * defaults to the app's own hosts (the BETTER_AUTH_URL host, or both hosts of a preview).
 */
function turnstileConfig():
  { siteKey: string; secretKey: string; allowedHostnames: string[] } | undefined {
  const siteKey = optional("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  const secretKey = optional("TURNSTILE_SECRET_KEY");
  if (siteKey && secretKey) {
    // Pin tokens to our own host so one minted for another site on the same widget key is refused.
    const allowedHostnames = list("TURNSTILE_ALLOWED_HOSTNAMES") ?? [
      ...new Set(trustedOrigins.map((origin) => new URL(origin).hostname)),
    ];
    return { siteKey, secretKey, allowedHostnames };
  }
  if ((siteKey || secretKey) && !isBuild) {
    throw new Error(
      "Incomplete Turnstile config: set both NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (or neither).",
    );
  }
  return undefined;
}

export const turnstileEnv = turnstileConfig();

/** Postgres URL. Malformed means postgres-js would throw on first import of the auth module. */
function databaseUrl(): string | undefined {
  return runtimeOnly(
    "DATABASE_URL",
    () => {
      const url = optional("DATABASE_URL");
      if (url && !isUrl(url)) throw new Error("DATABASE_URL is not a valid connection URL.");
      return url;
    },
    undefined,
  );
}

export const authEnv = {
  /** Supabase transaction-pooler (port 6543) URL works here; postgres-js runs with prepare:false. */
  databaseUrl: databaseUrl(),
  /** Min 32 chars. Generate with `openssl rand -base64 32`. */
  betterAuthSecret: optional("BETTER_AUTH_SECRET"),
  /** Versioned secrets for rotation; when set, BETTER_AUTH_SECRET only decrypts older payloads. */
  betterAuthSecrets: betterAuthSecrets(),
  /** Canonical app origin, e.g. https://receiptocr.example.com. Defaults to localhost in dev. */
  betterAuthUrl: appUrl,
  /** Exact origins Better Auth and `crossOriginResponse()` accept. Only previews add any. */
  trustedOrigins,
  /** Client-IP resolution shared by Better Auth's limiter and `clientIp()`. */
  ipAddress: { ipAddressHeaders: trustedIpHeaders(), trustedProxies: trustedProxies() },
  /** Emails auto-promoted to the `admin` role when they sign up. */
  adminEmails: adminEmailList(),
  google: socialProvider("GOOGLE"),
  github: socialProvider("GITHUB"),
};

/**
 * Auth requires a database and a signing secret (BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS). When either is missing the
 * app degrades gracefully: auth endpoints return 503 and the sign-in/up pages
 * render a "not configured" card instead of crashing.
 */
export const authEnabled = Boolean(
  authEnv.databaseUrl && (authEnv.betterAuthSecret || authEnv.betterAuthSecrets),
);

const currentSecret = authEnv.betterAuthSecrets?.[0]?.value ?? authEnv.betterAuthSecret;
if (currentSecret && currentSecret.length < 32 && !isBuild) {
  console.warn(
    "The current auth secret is shorter than 32 characters; generate a stronger one with `openssl rand -base64 32`.",
  );
}

// Without a trusted IP header every client shares one rate-limit bucket, so a
// few bad sign-ins from anyone lock everybody out. Refuse to start instead.
if (
  isProduction &&
  !isBuild &&
  authEnabled &&
  !process.env.VERCEL &&
  !authEnv.ipAddress.ipAddressHeaders
) {
  throw new Error(
    "TRUSTED_IP_HEADERS must be set in production off Vercel: name the header your reverse proxy sets to the client IP (e.g. x-forwarded-for), and set TRUSTED_PROXIES if the proxy appends to it.",
  );
}
if (isProduction && !requireEmailVerification) {
  console.warn(
    "AUTH_REQUIRE_EMAIL_VERIFICATION=false in production: anyone can register an address they don't own.",
  );
}
