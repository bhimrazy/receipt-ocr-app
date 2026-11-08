"use server";

import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isProduction } from "@/lib/env";
import { errorFields, logger } from "@/lib/log";
import { SECURITY_PROMPT_COOKIE } from "@/lib/security-prompt";
import { getSession } from "@/lib/session";
import { setFirstPassword, type SetPasswordResult } from "@/lib/set-password";

/** Settings → Security actions that Better Auth has no browser endpoint for. */

const SIGNED_OUT = { ok: false as const, error: "Your session ended. Sign in again." };

/** A first password for a Google/GitHub-only account, behind a fresh step-up. */
export async function setPasswordAction(input: {
  newPassword: string;
}): Promise<SetPasswordResult> {
  const session = await getSession();
  if (!session) return SIGNED_OUT;
  return setFirstPassword(session, await headers(), input?.newPassword);
}

/**
 * Sends the confirmation link again from a signed-in session. Server-side, so no captcha; the
 * per-address hourly cap in auth.ts's sendVerificationEmail still applies.
 */
export async function sendVerificationAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return SIGNED_OUT;
  if (session.user.emailVerified) return { ok: true };
  try {
    await auth.api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: "/app/settings/security" },
      headers: await headers(),
    });
  } catch (error) {
    logger.error({
      event: "auth.verification_resend_failed",
      unit: "log",
      error: errorFields(error),
    });
    return { ok: false, error: "We couldn't send the email. Try again in a minute." };
  }
  return { ok: true };
}

/** Hides the one-time "protect your receipts" card for this user in this browser, for good. */
export async function dismissSecurityPromptAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  (await cookies()).set(SECURITY_PROMPT_COOKIE, session.user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
}
