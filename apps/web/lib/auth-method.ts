/**
 * How a session was created, stored on `session.auth_method`. The admin guard
 * treats `mfa` and `passkey` as having proved a second factor at sign-in.
 */
export type AuthMethod =
  "password" | "mfa" | "oauth" | "email_link" | "passkey" | "impersonation" | "unknown";

/**
 * `existing` is the value on the data Better Auth is about to insert: a
 * rotated session (enable/disable 2FA) carries its predecessor's, even null,
 * and keeps it. A brand-new session has none and is classified by endpoint.
 */
export function authMethodFor(
  path: string | undefined,
  existing: string | null | undefined,
): AuthMethod | string | null {
  if (existing !== undefined) return existing;
  if (!path) return "unknown";
  if (path.startsWith("/two-factor/verify-")) return "mfa";
  if (path === "/passkey/verify-authentication") return "passkey";
  if (path === "/admin/impersonate-user") return "impersonation";
  if (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/")) return "oauth";
  if (path === "/sign-in/social") return "oauth";
  if (path === "/verify-email") return "email_link";
  if (path === "/sign-in/email" || path === "/sign-up/email") return "password";
  return "unknown";
}
