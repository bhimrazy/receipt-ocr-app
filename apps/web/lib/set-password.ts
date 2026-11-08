import "server-only";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth, deliverEmail } from "./auth";
import { passwordSet } from "./auth-accounts";
import { errorFields, logger } from "./log";
import { requireStepUp, STEP_UP_REQUIRED, StepUpRequiredError } from "./step-up-check";

export type SetPasswordResult =
  { ok: true } | { ok: false; error: string; code?: typeof STEP_UP_REQUIRED; action?: string };

const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters for your password.")
  .max(128, "Use 128 characters or fewer for your password.");

/**
 * A first password for an account that signs in only with Google or GitHub. Better Auth's
 * set-password is server-only and has no path, so the shared hooks.before gate can't see it:
 * the step-up check here is the only one, as strict as for a password change.
 */
export async function setFirstPassword(
  session: { session: { id: string }; user: { id: string; email: string } },
  headers: Headers,
  newPassword: unknown,
): Promise<SetPasswordResult> {
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a password." };
  }
  try {
    await requireStepUp(session, "account.change_password");
    await auth.api.setPassword({ body: { newPassword: parsed.data }, headers });
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { ok: false, error: error.message, code: STEP_UP_REQUIRED, action: error.action };
    }
    if (error instanceof APIError && error.body?.code === "PASSWORD_ALREADY_SET") {
      return { ok: false, error: "This account already has a password. Change it in Settings." };
    }
    logger.error({ event: "auth.set_password_failed", unit: "log", error: errorFields(error) });
    return { ok: false, error: "Something went wrong. Try again." };
  }
  await passwordSet(deliverEmail, session.user);
  return { ok: true };
}
