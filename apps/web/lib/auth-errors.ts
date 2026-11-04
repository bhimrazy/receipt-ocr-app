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
  if (error.status === 429) return RATE_LIMITED;
  const code = error.code?.toUpperCase();
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
