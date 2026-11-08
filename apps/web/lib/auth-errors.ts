/**
 * Plain-language copy for Better Auth error codes. Better Auth's own messages ("Invalid token",
 * "User already exists. Use another email.") are written for developers; these say what happened
 * and what to do next.
 */

export interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number;
}

const FALLBACK = "Something went wrong. Try again.";

export const SUSPENDED_MESSAGE =
  "This account is suspended. If you think this is a mistake, contact support.";

const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    "That email and password don't match an account. Check both and try again.",
  INVALID_EMAIL: "Enter a valid email address, for example name@example.com.",
  INVALID_PASSWORD: "That password is not correct.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "Use 128 characters or fewer for your password.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  EMAIL_NOT_VERIFIED: "Confirm your email address before you sign in.",
  INVALID_TOKEN: "This link is not valid or was already used. Request a new one.",
  TOKEN_EXPIRED: "This link has expired. Request a new one.",
  USER_NOT_FOUND: "We couldn't find an account for this link.",
  // Two-step sign-in (Better Auth's twoFactor plugin).
  INVALID_CODE: "That code isn't right. Check your app and enter the newest code.",
  INVALID_BACKUP_CODE: "That backup code isn't right, or it was already used.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Sign in again to get a new try.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in step has expired. Sign in again.",
  ACCOUNT_TEMPORARILY_LOCKED:
    "Too many wrong codes. Sign-in with a code is paused for 15 minutes; try again later.",
  TOTP_ALREADY_ENABLED: "Two-step sign-in is already on.",
  STEP_UP_REQUIRED: "Confirm it's you to continue.",
  IMPERSONATING: "You can't do this while signed in as another user.",
  // Turnstile (Better Auth's captcha plugin).
  MISSING_RESPONSE: "Finish the security check, then try again.",
  VERIFICATION_FAILED: "The security check failed. Reload the page and try again.",
  // A banned user: the error code of an email sign-in, or `?error=BANNED_USER` after a social one.
  BANNED_USER: SUSPENDED_MESSAGE,
  // OAuth callback errors arrive on /sign-in as `?error=<code>`.
  ACCESS_DENIED: "Sign-in was cancelled. Try again, or use your email and password.",
  ACCOUNT_NOT_LINKED:
    "This email already has an account. Sign in with your email and password instead.",
  EMAIL_NOT_FOUND: "Your provider didn't share an email address, so we couldn't sign you in.",
};

/** On /sign-in these codes come from an email-confirmation link (`/api/auth/verify-email`). */
const callbackMessages: Record<string, string> = {
  INVALID_TOKEN:
    "This confirmation link is not valid or was already used. Sign in to get a new one.",
  TOKEN_EXPIRED: "This confirmation link has expired. Sign in and we'll email you a new one.",
};

const RATE_LIMITED = "Too many attempts. Wait 1 minute and try again.";

/** Copy for an error returned by an `authClient` call. */
export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return FALLBACK;
  const code = error.code?.toUpperCase();
  // The 2FA lockout is a 429 with its own code and a 15-minute wait.
  if (code === "ACCOUNT_TEMPORARILY_LOCKED") return messages[code]!;
  if (error.status === 429) return RATE_LIMITED;
  if (code && messages[code]) return messages[code];
  return error.message?.trim() || FALLBACK;
}

/**
 * Copy for an `?error=` code that Better Auth appends to a callback URL (OAuth or email
 * verification). Unknown codes get a generic line rather than echoing the raw query value.
 */
export function callbackErrorMessage(code: string | string[] | undefined): string | undefined {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return undefined;
  const upper = value.toUpperCase();
  const known = callbackMessages[upper] ?? messages[upper];
  if (known) return known;
  return "We couldn't sign you in. Try again, or use your email and password.";
}

/** Errors on the code step that need a fresh password step: the challenge is gone. */
export function twoFactorRestart(error: AuthErrorLike | null | undefined): boolean {
  const code = error?.code?.toUpperCase();
  return code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" || code === "INVALID_TWO_FACTOR_COOKIE";
}

/** Copy for a failed passkey ceremony; a cancel or timeout is the common case. */
export function passkeyErrorMessage(error: AuthErrorLike | null | undefined): string {
  const code = error?.code?.toUpperCase() ?? "";
  // SimpleWebAuthn reports a dismissed or timed-out prompt (NotAllowedError) as a passthrough.
  if (
    code === "AUTH_CANCELLED" ||
    code === "ERROR_CEREMONY_ABORTED" ||
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"
  ) {
    return "Cancelled or timed out. Try again.";
  }
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || code === "PREVIOUSLY_REGISTERED") {
    return "This passkey is already on your account.";
  }
  if (code === "SESSION_NOT_FRESH")
    return "For your safety, sign out and in again, then add the passkey.";
  if (code === "PASSKEY_NOT_FOUND" || code === "AUTHENTICATION_FAILED") {
    return "That passkey didn't work here. Use another one, or sign in with your password.";
  }
  return authErrorMessage(error);
}
