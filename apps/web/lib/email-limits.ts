import "server-only";
import { createHash } from "node:crypto";
import { hitRateLimit } from "@receipt-ocr/core";
import { logger } from "./log";
import { runtime } from "./runtime";

/** Password-reset or verification emails one address may receive per hour, per kind. */
export const AUTH_EMAILS_PER_HOUR = 3;

export type AuthEmailKind = "password-reset" | "verification";

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
    if (!allowed) logger.info({ event: "auth.email_rate_limited", kind });
    return allowed;
  } catch (error) {
    logger.error({
      event: "auth.email_rate_limit_failed",
      kind,
      error: { type: error instanceof Error ? error.name : "Unknown" },
    });
    return true;
  }
}
