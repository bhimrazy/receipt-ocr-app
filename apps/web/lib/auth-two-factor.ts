import "server-only";
import { forgetTrustedDevices } from "@receipt-ocr/core";
import {
  backupCodesRegeneratedEmail,
  twoFactorDisabledEmail,
  twoFactorEnabledEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { authMethodFor } from "./auth-method";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";
import { checkStepUp, STEP_UP_MESSAGES, STEP_UP_REQUIRED } from "./step-up-check";
import { isFactorEndpoint, stepUpActionFor } from "./step-up-paths";

/**
 * Two-factor sign-in and step-up wiring for Better Auth, kept out of auth.ts
 * so that file only plugs these in. Plan: docs/plans/2026-11-06-passkeys-2fa.md.
 */

type Deliver = (input: SendEmailInput) => Promise<void>;

const BLOCKED = new Set(["/two-factor/get-totp-uri"]);

/** Defaults kept: 6-digit / 30 s TOTP, 10 encrypted backup codes, 10-min challenge, lockout 10 / 15 min. */
export const twoFactorPlugin = () =>
  twoFactor({
    issuer: "receiptOCR",
    // Google/GitHub-only users have no password to confirm with; anyone with one still needs it.
    allowPasswordless: true,
    // Opt-in per sign-in ("Trust this device for 30 days"); revoked in full on disable or reset.
    trustDeviceMaxAge: 30 * 24 * 60 * 60,
  });

export const authMethodSessionField = {
  authMethod: { type: "string", required: false, input: false },
} as const;

/** For `databaseHooks.session.create.before`: how this session was created. */
export const authMethodOf = (
  session: { authMethod?: string | null },
  ctx: { path?: string } | null | undefined,
) => authMethodFor(ctx?.path, session.authMethod);

/** Sends a security notice without ever failing the change it reports. */
async function notify(deliver: Deliver, input: SendEmailInput, kind: string) {
  try {
    await deliver(input);
  } catch (error) {
    logger.error({
      event: "auth.security_email_failed",
      unit: "log",
      kind,
      error: errorFields(error),
    });
  }
}

/**
 * Before any auth endpoint: refuses factor changes from an impersonation
 * session, and requires a fresh step-up for the endpoints listed in
 * step-up-paths (account deletion, password change, 2FA disable, admin calls…).
 */
export const twoFactorBeforeHook = createAuthMiddleware(async (ctx) => {
  // Returns the decrypted TOTP secret; the app never needs it, and a stolen session must not get it.
  if (BLOCKED.has(ctx.path)) throw new APIError("NOT_FOUND");
  const action = stepUpActionFor(ctx.path, ctx.body);
  const factor = isFactorEndpoint(ctx.path);
  if (!action && !factor) return;
  const session = await getSessionFromCtx(ctx);
  if (!session) return; // the endpoint answers 401 (or runs a sign-in step) itself
  if (factor && session.session.impersonatedBy) {
    throw new APIError("FORBIDDEN", {
      message: STEP_UP_MESSAGES.impersonating,
      code: "IMPERSONATING",
    });
  }
  if (!action) return;
  const check = await checkStepUp(session.session.id, action);
  if (check.ok) return;
  logger.info({
    event: "auth.step_up_required",
    unit: "log",
    user_id: session.user.id,
    action,
    outcome: check.reason,
  });
  throw new APIError("FORBIDDEN", {
    message: STEP_UP_MESSAGES[check.reason],
    code: STEP_UP_REQUIRED,
  });
});

/** After a successful backup-code regeneration: tell the user. */
export const twoFactorAfterHook = (deliver: Deliver) =>
  createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/two-factor/generate-backup-codes") return;
    if (isAPIError(ctx.context.returned)) return;
    const user = ctx.context.session?.user;
    if (!user) return;
    logger.info({ event: "auth.backup_codes_regenerated", unit: "log", user_id: user.id });
    await notify(deliver, { to: user.email, ...backupCodesRegeneratedEmail() }, "backup_codes");
  });

/**
 * For `databaseHooks.user.update.after`: the twoFactor plugin flips
 * `twoFactorEnabled` on the first verified code and off on disable.
 */
export const twoFactorUserUpdated =
  (deliver: Deliver) =>
  async (
    user: { id: string; email: string; twoFactorEnabled?: boolean | null },
    ctx: { path?: string } | null,
  ) => {
    if (ctx?.path === "/two-factor/verify-totp" && user.twoFactorEnabled) {
      logger.info({ event: "auth.two_factor_enabled", unit: "log", user_id: user.id });
      await notify(deliver, { to: user.email, ...twoFactorEnabledEmail() }, "two_factor_enabled");
    }
    if (ctx?.path === "/two-factor/disable" && !user.twoFactorEnabled) {
      // Better Auth forgets only this device's trust; drop the others and any pending challenge.
      await runtime.runPromise(forgetTrustedDevices(user.id)).catch((error: unknown) =>
        logger.error({
          event: "auth.trusted_devices_forget_failed",
          unit: "log",
          user_id: user.id,
          error: errorFields(error),
        }),
      );
      logger.info({ event: "auth.two_factor_disabled", unit: "log", user_id: user.id });
      await notify(
        deliver,
        { to: user.email, ...twoFactorDisabledEmail({ byAdmin: false }) },
        "two_factor_disabled",
      );
    }
  };
