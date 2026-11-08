import "server-only";
import { enqueueWelcomeEmail } from "@receipt-ocr/core";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";

/**
 * Whether a new account is welcomed the moment it is created: it is already verified (Google,
 * GitHub) or nothing will verify it (verification switched off). Email sign-ups that must verify
 * are welcomed after verification instead (`afterEmailVerification`).
 */
export const welcomeAtCreation = (
  user: { emailVerified: boolean },
  verificationRequired: boolean,
) => user.emailVerified || !verificationRequired;

/**
 * Queues the one-time welcome email (an `email.welcome` job). Safe to call from several hooks:
 * the queue welcomes a user once. A failure is logged, never thrown: sign-up must not fail
 * over a welcome.
 */
export async function queueWelcomeEmail(userId: string) {
  try {
    await runtime.runPromise(enqueueWelcomeEmail(userId));
  } catch (error) {
    logger.error({
      event: "email.welcome_enqueue_failed",
      unit: "log",
      user_id: userId,
      error: errorFields(error),
    });
  }
}
