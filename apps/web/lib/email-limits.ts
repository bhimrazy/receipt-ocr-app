import "server-only";
import { createHash } from "node:crypto";
import { hitRateLimit, rateLimitReached } from "@receipt-ocr/core";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";

/** Auth emails of one kind (reset, verification, ...) one address may receive per hour. */
export const AUTH_EMAILS_PER_HOUR = 3;

export type AuthEmailKind = "password-reset" | "verification" | "delete-account" | "change-email";

/**
 * Per-address cap for Better Auth's email hooks. Better Auth limits these
 * endpoints per IP only, so many IPs could still flood one inbox.
 *
 * The caller skips the send instead of throwing: an error would only happen for
 * addresses that have an account, which would reveal that they do. The address
 * is hashed so the rate-limit table holds no email addresses. A limiter failure
 * lets the email through; refusing would break sign-up and reset with the DB.
 */
export async function allowAuthEmail(kind: AuthEmailKind, email: string): Promise<boolean> {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  try {
    const { allowed } = await runtime.runPromise(
      hitRateLimit(`email:${kind}:${digest}`, 60 * 60 * 1000, AUTH_EMAILS_PER_HOUR),
    );
    if (!allowed) logger.info({ event: "auth.email_rate_limited", unit: "log", kind });
    return allowed;
  } catch (error) {
    logger.error({
      event: "auth.email_rate_limit_failed",
      unit: "log",
      kind,
      error: errorFields(error),
    });
    return true;
  }
}

/** Failed sign-ins one address may make per window; only failures count. */
export const SIGN_IN_FAILURES_PER_WINDOW = 10;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
/** Password-change attempts one user may make per window. */
export const PASSWORD_CHANGES_PER_WINDOW = 10;

const digestOf = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
const signInKey = (email: string) => `signin-fail:${digestOf(email)}`;

/**
 * Whether sign-in is closed for this address. Same answer whether or not an account exists, and
 * it runs before the password is checked, so a correct guess during a lockout learns nothing.
 *
 * The window is fixed from the first failure and never extended by blocked attempts, so a lock
 * ends at most 15 minutes later: no permanent lockout. Trade-off: someone who knows an address
 * can keep it blocked by sending 10 bad passwords per window from many IPs (Better Auth's
 * per-IP limit still applies). The owner still has password reset and the OAuth buttons, and
 * that costs the attacker steady traffic, where without a limit guessing is free. A limiter
 * failure lets the attempt through, as `allowAuthEmail` does.
 */
export async function signInBlocked(email: string): Promise<boolean> {
  try {
    return await runtime.runPromise(
      rateLimitReached(signInKey(email), SIGN_IN_WINDOW_MS, SIGN_IN_FAILURES_PER_WINDOW),
    );
  } catch (error) {
    logger.error({ event: "auth.sign_in_limit_failed", unit: "log", error: errorFields(error) });
    return false;
  }
}

/** Counts one failed sign-in (wrong password or unknown address alike). */
export async function recordSignInFailure(email: string): Promise<void> {
  try {
    const { allowed } = await runtime.runPromise(
      hitRateLimit(signInKey(email), SIGN_IN_WINDOW_MS, SIGN_IN_FAILURES_PER_WINDOW),
    );
    if (!allowed) logger.info({ event: "auth.sign_in_locked", unit: "log" });
  } catch (error) {
    logger.error({ event: "auth.sign_in_limit_failed", unit: "log", error: errorFields(error) });
  }
}

/** Counts a password-change attempt; false once the user is over the cap. */
export async function allowPasswordChange(userId: string): Promise<boolean> {
  try {
    const { allowed } = await runtime.runPromise(
      hitRateLimit(`pwchange:${userId}`, SIGN_IN_WINDOW_MS, PASSWORD_CHANGES_PER_WINDOW),
    );
    return allowed;
  } catch (error) {
    logger.error({ event: "auth.sign_in_limit_failed", unit: "log", error: errorFields(error) });
    return true;
  }
}
