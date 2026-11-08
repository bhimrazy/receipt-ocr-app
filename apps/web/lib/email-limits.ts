import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { clearRateLimit, hitRateLimit } from "@receipt-ocr/core";
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

/** Contact-form auto-replies: per recipient address and per sending IP, in one day. */
export const CONTACT_REPLY_LIMITS = {
  windowMs: 24 * 60 * 60 * 1000,
  perAddress: 1,
  perIp: 3,
} as const;

/**
 * Whether a contact-form submission (already past Turnstile) may get an auto-reply. The reply goes
 * to whatever address was typed, so both caps bound how much mail we can be made to send. The IP
 * counter is hit first, so an over-limit IP doesn't use up an address's one reply. Unlike auth
 * mail, a limiter failure skips the reply: the message itself still reaches support. Without a
 * client IP only the address cap applies (one shared bucket would silence everyone).
 */
export async function allowContactReply(email: string, ip: string | null): Promise<boolean> {
  const { windowMs, perAddress, perIp } = CONTACT_REPLY_LIMITS;
  try {
    if (ip) {
      const byIp = await runtime.runPromise(
        hitRateLimit(`contact-reply:ip:${digestOf(ip)}`, windowMs, perIp),
      );
      if (!byIp.allowed) return false;
    }
    const byAddress = await runtime.runPromise(
      hitRateLimit(`contact-reply:to:${digestOf(email)}`, windowMs, perAddress),
    );
    return byAddress.allowed;
  } catch (error) {
    logger.error({
      event: "contact.reply_rate_limit_failed",
      unit: "log",
      error: errorFields(error),
    });
    return false;
  }
}

/**
 * Lets a server action learn that the verification hook skipped the send because of the cap.
 * Better Auth awaits the hook for a signed-in resend, so the flag is set before the call returns.
 */
export const verificationSend = new AsyncLocalStorage<{ suppressed: boolean }>();

/** Sign-in attempts one address may make per window; a correct one resets the count. */
export const SIGN_IN_ATTEMPTS_PER_WINDOW = 10;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
/** Password-change attempts one user may make per window. */
export const PASSWORD_CHANGES_PER_WINDOW = 10;

const digestOf = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
const signInKey = (email: string) => `signin-fail:${digestOf(email)}`;

/**
 * Counts a sign-in attempt for this address before the password is checked, and says whether it
 * may proceed. The increment and the check are one atomic statement, so parallel requests can't
 * each slip in a guess while the count is still low. Same answer whether or not an account exists.
 *
 * The window is fixed from the first attempt and blocked attempts don't extend it, so a lock
 * ends at most 15 minutes later: no permanent lockout. A correct sign-in clears the counter
 * (`clearSignInAttempts`), so only the real password resets it. Trade-off: someone who knows an
 * address can keep it blocked by sending 10 bad passwords per window from many IPs (Better
 * Auth's per-IP limit still applies). The owner still has password reset and OAuth, and it costs
 * the attacker steady traffic. A limiter failure lets the attempt through, as `allowAuthEmail` does.
 */
export async function allowSignInAttempt(email: string): Promise<boolean> {
  try {
    const { allowed } = await runtime.runPromise(
      hitRateLimit(signInKey(email), SIGN_IN_WINDOW_MS, SIGN_IN_ATTEMPTS_PER_WINDOW),
    );
    if (!allowed) logger.info({ event: "auth.sign_in_locked", unit: "log" });
    return allowed;
  } catch (error) {
    logger.error({ event: "auth.sign_in_limit_failed", unit: "log", error: errorFields(error) });
    return true;
  }
}

/** Forgets an address's attempts after a correct sign-in. */
export async function clearSignInAttempts(email: string): Promise<void> {
  try {
    await runtime.runPromise(clearRateLimit(signInKey(email)));
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
