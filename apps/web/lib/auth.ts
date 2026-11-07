import "server-only";
import { authRateLimitRules } from "./auth-rate-limit";
import {
  DEFAULT_PLANS,
  ensurePersonalWorkspace,
  policyFor,
  prepareUserDeletion,
  purgeReceiptFiles,
  releaseMemberGroups,
  userPlan,
} from "@receipt-ocr/core";
import { and, createDb, eq, member, schema, user as userTable } from "@receipt-ocr/db";
import {
  deleteAccountEmail,
  emailChangeEmail,
  invitationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  sendEmail,
  type EmailLogEvent,
  verificationEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { captcha } from "better-auth/plugins/captcha";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { isBootstrapAdmin } from "./admin-bootstrap";
import { CAPTCHA_ENDPOINTS } from "./captcha-endpoints";
import { assertWorkspaceRole, limitInvitations, validateWorkspaceName } from "./auth-guards";
import { allowAuthEmail, type AuthEmailKind } from "./email-limits";
import {
  authEnabled,
  authEnv,
  emailEnv,
  isProduction,
  logUndeliveredMail,
  requireEmailVerification,
  supportEmail,
  turnstileEnv,
} from "./env";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";
import {
  DELETE_TOKEN_SECONDS,
  FRESH_AGE_SECONDS,
  SESSION_NOT_FRESH,
  deleteConfirmUrl,
  isSessionFresh,
  needsFreshSession,
} from "./step-up";

export { authEnabled };

/**
 * Placeholder used only when auth is disabled (missing DATABASE_URL /
 * BETTER_AUTH_SECRET) so the module can still be imported at build time.
 * postgres-js connects lazily, so no connection is ever made: every caller is
 * expected to gate on `authEnabled` before hitting an auth endpoint.
 */
const PLACEHOLDER_DATABASE_URL = "postgres://placeholder:placeholder@localhost:5432/placeholder";
const PLACEHOLDER_SECRET = "auth-disabled-placeholder-secret-do-not-use-0000";

const db = createDb(authEnv.databaseUrl ?? PLACEHOLDER_DATABASE_URL);

const mailer = {
  apiKey: emailEnv.resendApiKey,
  from: emailEnv.from,
  replyTo: emailEnv.replyTo,
  logUndelivered: logUndeliveredMail(),
  log: (event: EmailLogEvent) => logger.emit(event),
};

/**
 * In production an undelivered reset/verification/invite mail fails the
 * request: a silent success would leave the user waiting for nothing.
 */
async function deliver(input: SendEmailInput) {
  const result = await sendEmail(mailer, input);
  if (!result.delivered && isProduction) {
    throw new Error(`Email not delivered (${result.reason})`);
  }
}

/**
 * For emails a signed-in user asked for (deletion, email change). Unlike sign-up and reset,
 * refusing says nothing about whether an address has an account, so the user is told.
 */
async function limitSignedInEmail(kind: AuthEmailKind, email: string) {
  if (!(await allowAuthEmail(kind, email))) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "We've sent this email several times in the last hour. Try again later.",
    });
  }
}

/**
 * Security notices (password changed) go out after the change has happened, so a failed send
 * is logged and never fails the request.
 */
async function notify(input: SendEmailInput, userId: string, kind: string) {
  const result = await sendEmail(mailer, input).catch(() => ({ delivered: false as const }));
  logger.info({
    event: "auth.notice_sent",
    unit: "log",
    user_id: userId,
    kind,
    delivered: result.delivered,
  });
}

/** Password reset page and support inbox for "if this wasn't you" in notices. */
const recovery = () => ({
  resetUrl: new URL("/forgot-password", authEnv.betterAuthUrl).toString(),
  supportEmail,
});

async function notifyPasswordChanged(user: { id: string; email: string }, kind: string) {
  await notify({ to: user.email, ...passwordChangedEmail(recovery()) }, user.id, kind);
  logger.info({ event: "user.password_changed", unit: "log", user_id: user.id, kind });
}

/**
 * Grants the admin role to an ADMIN_EMAILS address only once it is verified;
 * granting it at sign-up would hand admin to whoever registers the address first.
 */
async function promoteIfBootstrapAdmin(user: {
  id: string;
  email: string;
  emailVerified: boolean;
}) {
  if (!isBootstrapAdmin(user, authEnv.adminEmails)) return;
  await db
    .update(userTable)
    .set({ role: "admin" })
    .where(and(eq(userTable.id, user.id), eq(userTable.emailVerified, true)));
}

/** Removes stored receipt files before the rows they belong to cascade away (U1). */
async function purgeFiles(owner: { organizationId: string } | { userId: string }) {
  const purged = await runtime.runPromise(purgeReceiptFiles(owner));
  logger.info({
    event: "receipt.files_purged",
    unit: "log",
    ...("userId" in owner ? { user_id: owner.userId } : { organization_id: owner.organizationId }),
    count: purged,
  });
}

/**
 * Before a user row goes: deletes the workspaces only they belong to (files
 * first) and refuses while they own a shared workspace with no other owner.
 * Shared-workspace receipts they uploaded stay, with no uploader.
 */
export async function deleteOwnData(userId: string) {
  const exit = await runtime.runPromiseExit(prepareUserDeletion(userId));
  if (exit._tag === "Success") {
    logger.info({
      event: "user.data_deleted",
      unit: "log",
      user_id: userId,
      counts: { workspaces: exit.value.workspacesDeleted, files: exit.value.files },
    });
    return exit.value;
  }
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
  if (failure?._tag === "Conflict") throw new APIError("BAD_REQUEST", { message: failure.message });
  throw new Error("Could not delete the user's workspaces", { cause: exit.cause });
}

export const auth = betterAuth({
  appName: "receiptOCR",
  baseURL: authEnv.betterAuthUrl,
  // With BETTER_AUTH_SECRETS set, `secret` is only the legacy key for payloads sealed before it.
  secret: authEnv.betterAuthSecret ?? (authEnv.betterAuthSecrets ? undefined : PLACEHOLDER_SECRET),
  secrets: authEnv.betterAuthSecrets,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: authEnv.trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    requireEmailVerification,
    sendResetPassword: async ({ user, url }) => {
      if (!(await allowAuthEmail("password-reset", user.email))) return;
      await deliver({ to: user.email, ...passwordResetEmail(url) });
    },
    // Changes through Settings are noticed by the after hook below.
    onPasswordReset: async ({ user }) => notifyPasswordChanged(user, "reset"),
  },
  emailVerification: {
    // Dev logs the link; in production a send without a mailer throws, so only send when required.
    sendOnSignUp: requireEmailVerification || !isProduction,
    sendOnSignIn: requireEmailVerification,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!(await allowAuthEmail("verification", user.email))) return;
      await deliver({ to: user.email, ...verificationEmail(url) });
    },
    afterEmailVerification: async (user) => {
      await promoteIfBootstrapAdmin({ ...user, emailVerified: true });
    },
  },
  socialProviders: {
    ...(authEnv.google ? { google: authEnv.google } : {}),
    ...(authEnv.github ? { github: authEnv.github } : {}),
  },
  rateLimit: {
    enabled: true,
    // Memory storage resets per serverless instance; the database keeps
    // limits consistent across instances.
    storage: "database",
    customRules: authRateLimitRules,
  },
  // Reset and verification tokens are stored as hashes: a database read alone can't use them.
  verification: { storeIdentifier: "hashed" },
  // Rows sealed before this was on stay readable: Better Auth passes non-hex
  // (plaintext) tokens through and seals them on the user's next sign-in.
  account: { encryptOAuthTokens: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    // Requesting account deletion and changing the email need a sign-in this recent (hooks
    // below); Better Auth itself applies it to list-sessions and unlink-account.
    freshAge: FRESH_AGE_SECONDS,
    // Off: with the cache on, a revoked or banned session keeps working on
    // /api/auth/* for its maxAge (see GHSA-fvxx). App reads skip it anyway.
    cookieCache: { enabled: false },
  },
  advanced: {
    ipAddress: authEnv.ipAddress,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Deletes on a single GET; our confirm page posts the token to /delete-user instead.
      if (ctx.path === "/delete-user/callback") throw new APIError("NOT_FOUND");
      if (!needsFreshSession(ctx.path, ctx.body)) return;
      const current = await getSessionFromCtx(ctx);
      // No session: the endpoint itself answers 401.
      if (!current) return;
      if (isSessionFresh(current.session.createdAt)) {
        // Counts attempts, not sends: Better Auth sends nothing when the new address is taken,
        // so capping only real sends would answer 429 for a free address and 200 for a taken one.
        if (ctx.path === "/change-email")
          await limitSignedInEmail("change-email", current.user.email);
        return;
      }
      logger.info({
        event: "auth.step_up_required",
        unit: "log",
        user_id: current.user.id,
        action: ctx.path.slice(1),
      });
      throw new APIError("FORBIDDEN", {
        code: SESSION_NOT_FRESH,
        message: "Sign in again to continue.",
      });
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password" && ctx.path !== "/admin/set-user-password") return;
      const returned = ctx.context.returned as { user?: { id: string; email: string } } | undefined;
      if (!returned || isAPIError(returned)) return;
      if (ctx.path === "/change-password") {
        if (returned.user) await notifyPasswordChanged(returned.user, "change");
        return;
      }
      const userId = (ctx.body as { userId?: unknown } | undefined)?.userId;
      if (typeof userId !== "string") return;
      const [target] = await db
        .select({ id: userTable.id, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);
      if (target) await notifyPasswordChanged(target, "admin");
    }),
  },
  user: {
    deleteUser: {
      enabled: true,
      // With this set, /delete-user only emails a link; the account goes when that link's token
      // is posted back (single use, consumed before beforeDelete runs).
      deleteTokenExpiresIn: DELETE_TOKEN_SECONDS,
      sendDeleteAccountVerification: async ({ user, url, token }) => {
        await limitSignedInEmail("delete-account", user.email);
        await deliver({ to: user.email, ...deleteAccountEmail(deleteConfirmUrl(url, token)) });
        logger.info({ event: "user.delete_requested", unit: "log", user_id: user.id });
      },
      beforeDelete: async (user) => {
        await deleteOwnData(user.id);
      },
      afterDelete: async (user) => {
        logger.info({ event: "user.deleted", unit: "log", user_id: user.id });
      },
    },
    changeEmail: {
      enabled: true,
      // A verified user's current address approves first; Better Auth then sends the usual
      // verification email to the new one, and only that link changes the address.
      // The per-address cap runs in hooks.before, for every attempt.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await deliver({
          to: user.email,
          ...emailChangeEmail({ newEmail, url, ...recovery() }),
        });
        logger.info({ event: "user.email_change_requested", unit: "log", user_id: user.id });
      },
    },
    additionalFields: {
      plan: {
        type: "string",
        required: false,
        defaultValue: "free",
        input: false, // never accepted from the client
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Personal workspace + owner membership, in one transaction (U4).
          await runtime.runPromise(ensurePersonalWorkspace(user));
          // OAuth sign-ups can arrive already verified.
          await promoteIfBootstrapAdmin(user);
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Default the active organization to the user's personal workspace
          // (their first membership) so org-scoped APIs work immediately.
          const [membership] = await db
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, session.userId))
            .limit(1);
          return {
            data: {
              ...session,
              activeOrganizationId: membership?.organizationId ?? null,
            },
          };
        },
      },
    },
  },
  plugins: [
    organizationPlugin({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      // 7-day invitations. Cancel any older pending invite when re-inviting the
      // same email so a workspace never accumulates duplicate invitations.
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      sendInvitationEmail: async ({ email, invitation, organization, inviter }) => {
        const acceptUrl = `${authEnv.betterAuthUrl}/accept-invitation/${invitation.id}`;
        await deliver({
          to: email,
          ...invitationEmail({
            organizationName: organization.name,
            inviterEmail: inviter.user.email,
            url: acceptUrl,
          }),
        });
      },
      organizationHooks: {
        beforeCreateOrganization: ({ organization }) =>
          validateWorkspaceName(organization, { required: true }),
        beforeUpdateOrganization: ({ organization }) =>
          validateWorkspaceName(organization, { required: false }),
        beforeCreateInvitation: ({ invitation, inviter }) => {
          assertWorkspaceRole(invitation.role);
          return limitInvitations(inviter.id);
        },
        // Accepting copies the stored role to a member row without beforeAddMember,
        // so invitations stored before this check are re-checked here.
        beforeAcceptInvitation: async ({ invitation }) => assertWorkspaceRole(invitation.role),
        beforeAddMember: async ({ member }) => assertWorkspaceRole(member.role),
        beforeUpdateMemberRole: async ({ newRole }) => assertWorkspaceRole(newRole),
        // Workspace owners remove members through Better Auth, not the admin path.
        afterRemoveMember: async ({ member: removed, organization }) => {
          try {
            await runtime.runPromise(releaseMemberGroups(organization.id, removed.userId));
          } catch (error) {
            logger.error({
              event: "groups.release_member_failed",
              unit: "log",
              organization_id: organization.id,
              user_id: removed.userId,
              error: errorFields(error),
            });
          }
        },
        beforeDeleteOrganization: async ({ organization }) => {
          await purgeFiles({ organizationId: organization.id });
        },
      },
      // Returns true when the user has REACHED their plan's org limit. The plan
      // is read fresh (the session user can be five minutes stale).
      organizationLimit: async (user) => {
        const limit = await runtime
          .runPromise(userPlan(user.id))
          .then(({ policy }) => policy.workspaces)
          .catch(() => policyFor(DEFAULT_PLANS, null).workspaces);
        const owned = await db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, user.id), eq(member.role, "owner")));
        return owned.length >= limit;
      },
    }),
    admin({
      defaultRole: "user",
    }),
    // Reads the token from `x-captcha-response` and the client IP from advanced.ipAddress. A
    // missing token is a 400, a rejected one a 403, and a siteverify failure or timeout (10 s) a
    // 500: all fail closed.
    ...(turnstileEnv
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: turnstileEnv.secretKey,
            endpoints: [...CAPTCHA_ENDPOINTS],
            allowedHostnames: turnstileEnv.allowedHostnames,
          }),
        ]
      : []),
    // Keep nextCookies last so it can pick up Set-Cookie from server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
