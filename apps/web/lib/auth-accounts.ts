import "server-only";
import {
  canRemoveAccount,
  isSocialProvider,
  loadSignInMethods,
  PROVIDER_LABELS,
  SOCIAL_PROVIDERS,
  type SocialProviderId,
} from "@receipt-ocr/core";
import {
  passwordSetEmail,
  signInConnectedEmail,
  signInDisconnectedEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { authEnv, emailContext, resetPasswordUrl } from "./env";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";

/**
 * Sign-in methods wiring for Better Auth: the last-method guard on /unlink-account and the
 * notices when Google or GitHub is connected or disconnected. Kept out of auth.ts like
 * auth-two-factor.ts.
 */

type HookContext = Parameters<typeof getSessionFromCtx>[0] & { path: string; body?: unknown };
type Deliver = (input: SendEmailInput) => Promise<void>;

export const LAST_SIGN_IN_METHOD = "LAST_SIGN_IN_METHOD";
export const LAST_SIGN_IN_METHOD_MESSAGE = "Set a password or add a passkey first.";

/** Google and GitHub, as far as this deployment has them configured. */
export const configuredProviders = (): SocialProviderId[] =>
  SOCIAL_PROVIDERS.filter((id) => Boolean(authEnv[id]));

/**
 * Linking stays on Better Auth's defaults, written out so they are a decision: the provider must
 * report the same address as the account, verified (no trusted providers). A stolen session can't
 * attach the thief's Google or GitHub, and connecting adds no step-up because owning that address
 * already allows a password reset. Unlinking everything is allowed here only because
 * `guardUnlink` counts passkeys, which Better Auth's own last-account check ignores.
 */
export const accountLinking = {
  enabled: true,
  allowDifferentEmails: false,
  trustedProviders: [] as SocialProviderId[],
  allowUnlinkingAll: true,
};

/** In `hooks.before` for /unlink-account, after the step-up gate: never remove the last way in. */
export async function guardUnlink(ctx: HookContext) {
  const accountId = (ctx.body as { accountId?: unknown } | undefined)?.accountId;
  if (typeof accountId !== "string") return;
  const current = await getSessionFromCtx(ctx);
  if (!current) return;
  const methods = await runtime.runPromise(loadSignInMethods(current.user.id));
  if (!methods || canRemoveAccount(methods, accountId, configuredProviders())) return;
  logger.info({
    event: "auth.account_unlink_refused",
    unit: "log",
    user_id: current.user.id,
    outcome: "last_method",
  });
  throw new APIError("BAD_REQUEST", {
    code: LAST_SIGN_IN_METHOD,
    message: LAST_SIGN_IN_METHOD_MESSAGE,
  });
}

/** Sends a notice without ever failing the change it reports. */
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

type AccountRow = { userId: string; providerId: string };

/**
 * For `databaseHooks.account.create.after`. A provider account added to a user who already had
 * one is a link (from Settings, or Better Auth linking the same verified address at sign-in); a
 * user's first account is their sign-up and gets no notice.
 */
export const accountCreated = (deliver: Deliver) => async (account: AccountRow) => {
  if (!isSocialProvider(account.providerId)) return;
  const methods = await runtime.runPromise(loadSignInMethods(account.userId));
  if (!methods || methods.accounts.length < 2) return;
  logger.info({
    event: "auth.account_linked",
    unit: "log",
    user_id: account.userId,
    kind: account.providerId,
  });
  await notify(
    deliver,
    {
      to: methods.email,
      ...signInConnectedEmail(emailContext, {
        resetUrl: resetPasswordUrl(),
        provider: PROVIDER_LABELS[account.providerId],
      }),
    },
    "sign_in_connected",
  );
};

/** For `databaseHooks.account.delete.after`: only a user's own unlink, not an account deletion. */
export const accountDeleted =
  (deliver: Deliver) => async (account: AccountRow, ctx: { path?: string } | null) => {
    if (ctx?.path !== "/unlink-account") return;
    logger.info({
      event: "auth.account_unlinked",
      unit: "log",
      user_id: account.userId,
      kind: account.providerId,
    });
    if (!isSocialProvider(account.providerId)) return;
    const methods = await runtime.runPromise(loadSignInMethods(account.userId));
    if (!methods) return;
    await notify(
      deliver,
      {
        to: methods.email,
        ...signInDisconnectedEmail(emailContext, {
          resetUrl: resetPasswordUrl(),
          provider: PROVIDER_LABELS[account.providerId],
        }),
      },
      "sign_in_disconnected",
    );
  };

/** After Settings → Security set a first password on a Google/GitHub-only account. */
export async function passwordSet(deliver: Deliver, user: { id: string; email: string }) {
  logger.info({ event: "user.password_changed", unit: "log", user_id: user.id, kind: "set" });
  await notify(
    deliver,
    { to: user.email, ...passwordSetEmail(emailContext, { resetUrl: resetPasswordUrl() }) },
    "password_set",
  );
}
