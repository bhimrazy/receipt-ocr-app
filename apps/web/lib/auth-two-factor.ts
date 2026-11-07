import "server-only";
import { adoptPasskeySession, forgetTrustedDevices, type StepUpAction } from "@receipt-ocr/core";
import {
  backupCodesRegeneratedEmail,
  passkeyAddedEmail,
  passkeyRemovedEmail,
  twoFactorDisabledEmail,
  twoFactorEnabledEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { APIError, getSessionFromCtx, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { authMethodFor } from "./auth-method";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";
import { clientIp } from "./http";
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

/**
 * Passkeys for the site's own host only: rpID and origin come from
 * BETTER_AUTH_URL (production: receipt-ocr.bhimraj.com.np). Changing the host
 * later orphans every passkey. A preview works only on the host its
 * BETTER_AUTH_URL names. User verification (PIN, fingerprint, face) is required.
 */
export const passkeyPlugin = (appUrl: string) => {
  const url = new URL(appUrl);
  return passkey({
    rpID: url.hostname,
    rpName: "receiptOCR",
    origin: url.origin,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
};

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

type HookContext = Parameters<typeof getSessionFromCtx>[0] & { path: string; body?: unknown };
/** In `hooks.after`, Better Auth puts the endpoint's result on the context. */
type AfterContext = HookContext & { context: { returned?: unknown } };

/**
 * Called first in `hooks.before` for every auth endpoint: refuses factor
 * changes from an impersonation session, and requires a fresh step-up for the
 * endpoints listed in step-up-paths (account deletion, email and password
 * change, 2FA disable, admin calls…). Returns the action that passed, if any.
 */
export async function stepUpGate(ctx: HookContext): Promise<StepUpAction | null> {
  // Returns the decrypted TOTP secret; the app never needs it, and a stolen session must not get it.
  if (BLOCKED.has(ctx.path)) throw new APIError("NOT_FOUND");
  const action = stepUpActionFor(ctx.path, ctx.body);
  const factor = isFactorEndpoint(ctx.path);
  if (!action && !factor) return null;
  const session = await getSessionFromCtx(ctx);
  if (!session) return null; // the endpoint answers 401 (or runs a sign-in step) itself
  if (factor && session.session.impersonatedBy) {
    throw new APIError("FORBIDDEN", {
      message: STEP_UP_MESSAGES.impersonating,
      code: "IMPERSONATING",
    });
  }
  if (!action) return null;
  const check = await checkStepUp(session.session.id, action);
  if (check.ok) return action;
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
}

const AFTER_PATHS = new Set([
  "/two-factor/generate-backup-codes",
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
]);

/**
 * After a successful factor change: tell the user. After a passkey check: the
 * new session counts as a passed step-up and replaces the one it came from.
 */
export async function factorChangedAfter(ctx: AfterContext, deliver: Deliver) {
  if (!AFTER_PATHS.has(ctx.path) || isAPIError(ctx.context.returned)) return;
  if (ctx.path === "/passkey/verify-authentication") {
    const created = ctx.context.newSession;
    if (!created) return;
    const previousToken = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    await runtime.runPromise(
      adoptPasskeySession({
        previousToken:
          previousToken && previousToken !== created.session.token ? previousToken : null,
        sessionId: created.session.id,
        userId: created.user.id,
        ip: ctx.headers ? clientIp({ headers: ctx.headers }) : null,
      }),
    );
    return;
  }
  const user = ctx.context.session?.user;
  if (!user) return;
  if (ctx.path === "/two-factor/generate-backup-codes") {
    logger.info({ event: "auth.backup_codes_regenerated", unit: "log", user_id: user.id });
    await notify(deliver, { to: user.email, ...backupCodesRegeneratedEmail() }, "backup_codes");
  } else if (ctx.path === "/passkey/verify-registration") {
    logger.info({ event: "auth.passkey_added", unit: "log", user_id: user.id });
    await notify(deliver, { to: user.email, ...passkeyAddedEmail() }, "passkey_added");
  } else {
    logger.info({ event: "auth.passkey_removed", unit: "log", user_id: user.id });
    await notify(deliver, { to: user.email, ...passkeyRemovedEmail() }, "passkey_removed");
  }
}

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
