import "server-only";
import { securityPromptDue } from "@receipt-ocr/core";
import { cookies } from "next/headers";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";

/**
 * The one-time "protect your receipts" card after a user's fifth scanned receipt. Dismissing it
 * sets a cookie holding the user id, read on the server so the card never flashes in or out.
 * It is per browser: there is no per-user column for it yet (that needs a migration), so a
 * user who dismissed it on one device sees it once more on another.
 */
export const SECURITY_PROMPT_COOKIE = "receiptocr_security_prompt";

export async function showSecurityPrompt(session: {
  user: { id: string; twoFactorEnabled?: boolean | null };
  session: { impersonatedBy?: string | null };
}): Promise<boolean> {
  if (session.user.twoFactorEnabled || session.session.impersonatedBy) return false;
  const dismissed = (await cookies()).get(SECURITY_PROMPT_COOKIE)?.value;
  if (dismissed === session.user.id) return false;
  try {
    return await runtime.runPromise(securityPromptDue(session.user.id));
  } catch (error) {
    logger.error({ event: "app.security_prompt_failed", unit: "log", error: errorFields(error) });
    return false;
  }
}
