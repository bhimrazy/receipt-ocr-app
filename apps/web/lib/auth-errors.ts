/**
 * Sign-in errors in plain words, the same for email and social sign-in.
 * Better Auth reports a suspended account as `BANNED_USER`: as the error code
 * of an email sign-in, and as `?error=BANNED_USER` on the page a social
 * sign-in returns to.
 */

export const SUSPENDED_MESSAGE =
  "This account is suspended. If you think this is a mistake, contact support.";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function authErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === "BANNED_USER") return SUSPENDED_MESSAGE;
  return error.message || GENERIC_MESSAGE;
}

/** The message for a social sign-in that came back with `?error=`; null when there is none. */
export function socialErrorMessage(code: string | string[] | undefined): string | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return null;
  if (value === "BANNED_USER") return SUSPENDED_MESSAGE;
  return "Signing in with that account didn't work. Try again, or use your email and password.";
}
