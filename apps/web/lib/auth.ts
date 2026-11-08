import "server-only";
import { authRateLimitRules } from "./auth-rate-limit";
import { SITE_NAME } from "./site";
import {
  countOtherAdmins,
  DEFAULT_PLANS,
  ensurePersonalWorkspace,
  policyFor,
  prepareUserDeletion,
  workspacesBlockingDeletion,
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
  verificationEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { captcha } from "better-auth/plugins/captcha";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { isBootstrapAdmin } from "./admin-bootstrap";
import {
  accountCreated,
  accountDeleted,
  accountLinking,
  guardPasskeyDelete,
  guardUnlink,
} from "./auth-accounts";
// --- two-factor + step-up (feat/two-factor) ---
import {
  authMethodOf,
  authMethodSessionField,
  factorChangedAfter,
  replaceSessionOnSignIn,
  trustDeviceIdentifier,
  passkeyPlugin,
  stepUpGate,
  twoFactorPlugin,
  twoFactorUserUpdated,
} from "./auth-two-factor";
// --- end two-factor + step-up ---
import { CAPTCHA_ENDPOINTS } from "./captcha-endpoints";
import { assertWorkspaceRole, limitInvitations, validateWorkspaceName } from "./auth-guards";
import {
  allowAuthEmail,
  allowPasswordChange,
  allowSignInAttempt,
  clearSignInAttempts,
  type AuthEmailKind,
  verificationSend,
} from "./email-limits";
import {
  authEnabled,
  authEnv,
  emailContext,
  resetPasswordUrl,
  isProduction,
  requireEmailVerification,
  turnstileEnv,
} from "./env";
import { errorFields, logger } from "./log";
import { mailer } from "./mailer";
import { isEmailChangeVerification, queueWelcomeEmail, welcomeAtCreation } from "./welcome";
import { runtime } from "./runtime";
import { signUpMethod, track } from "./telemetry/analytics";
import {
  DELETE_TOKEN_SECONDS,
  WORKSPACE_NEEDS_OWNER,
  deleteConfirmUrl,
  hasDeleteToken,
  soleOwnerMessage,
} from "./account-deletion";

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

// two-factor + step-up (feat/two-factor): step-up codes are sent the same way.
export { deliver as deliverEmail };

/**
 * For emails a signed-in user asked for (deletion, email change). Unlike sign-up and reset,
 * refusing says nothing about whether an address has an account, so the user is told.
 */
const SIGN_IN_LIMITED_MESSAGE = "Too many sign-in attempts. Try again in a few minutes.";

function signInEmail(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

const ADMIN_GUARDED = new Set(["/admin/set-role", "/admin/ban-user", "/admin/remove-user"]);

/**
 * The admin plugin's endpoints answer any admin session directly, so the panel's guards (see
 * app/admin/actions.ts) are repeated here: no self-changes, no banning or removing an admin, and
 * never demoting the last unbanned admin.
 */
async function guardAdminEndpoint(ctx: Parameters<typeof getSessionFromCtx>[0]) {
  const current = await getSessionFromCtx(ctx);
  // Not signed in or not an admin: the plugin itself answers 401/403.
  if (!current || !current.user.role?.split(",").includes("admin")) return;
  const body = ctx.body as { userId?: unknown; role?: unknown } | undefined;
  const userId = typeof body?.userId === "string" ? body.userId : null;
  if (!userId) return;
  const refuse = (message: string) => new APIError("FORBIDDEN", { message });
  if (userId === current.user.id) throw refuse("You can't change your own account here.");
  const [target] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!target?.role?.split(",").includes("admin")) return;
  if (ctx.path !== "/admin/set-role") {
    throw refuse("Admins can't be banned or removed. Remove their admin role first.");
  }
  const roles = Array.isArray(body?.role) ? body.role : [body?.role];
  if (roles.includes("admin")) return;
  if ((await runtime.runPromise(countOtherAdmins(userId))) === 0) {
    throw refuse("This is the last admin. Promote someone else first.");
  }
}

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

/** Password reset page for "if this wasn't you" in notices. */
const recovery = () => ({ resetUrl: resetPasswordUrl() });

async function notifyPasswordChanged(user: { id: string; email: string }, kind: string) {
  await notify(
    { to: user.email, ...passwordChangedEmail(emailContext, recovery()) },
    user.id,
    kind,
  );
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
  if (failure?._tag === "Conflict") {
    // Core's message is worded for admins; name the workspaces for the user instead.
    throw soleOwnerError(await blockingNames(userId).catch(() => []), "request a new link");
  }
  throw new Error("Could not delete the user's workspaces", { cause: exit.cause });
}

// Link lifetimes, set here so the emails quote the same numbers (Better Auth's defaults).
const VERIFY_LINK_SECONDS = 60 * 60;
const RESET_LINK_SECONDS = 60 * 60;
const INVITATION_SECONDS = 60 * 60 * 24 * 7;

/** Shared workspaces only this user owns, by name: deletion is refused while there are any. */
const blockingNames = async (userId: string) =>
  (await runtime.runPromise(workspacesBlockingDeletion(userId))).map((w) => w.name);

/** Settings checks this before offering deletion; the server checks again on every step. */
const soleOwnerError = (names: string[], then: string) =>
  new APIError("BAD_REQUEST", {
    code: WORKSPACE_NEEDS_OWNER,
    message: soleOwnerMessage(names, then),
  });

export const auth = betterAuth({
  appName: SITE_NAME,
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
    resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
    requireEmailVerification,
    sendResetPassword: async ({ user, url }) => {
      if (!(await allowAuthEmail("password-reset", user.email))) return;
      await deliver({
        to: user.email,
        ...passwordResetEmail(emailContext, {
          url,
          expiresInSeconds: RESET_LINK_SECONDS,
        }),
      });
    },
    // Changes through Settings are noticed by the after hook below.
    onPasswordReset: async ({ user }) => notifyPasswordChanged(user, "reset"),
  },
  emailVerification: {
    // Dev logs the link; in production a send without a mailer throws, so only send when required.
    sendOnSignUp: requireEmailVerification || !isProduction,
    sendOnSignIn: requireEmailVerification,
    autoSignInAfterVerification: true,
    expiresIn: VERIFY_LINK_SECONDS,
    sendVerificationEmail: async ({ user, url }) => {
      if (!(await allowAuthEmail("verification", user.email))) {
        const report = verificationSend.getStore();
        if (report) report.suppressed = true;
        return;
      }
      await deliver({
        to: user.email,
        ...verificationEmail(emailContext, { url, expiresInSeconds: VERIFY_LINK_SECONDS }),
      });
    },
    afterEmailVerification: async (user, request) => {
      await promoteIfBootstrapAdmin({ ...user, emailVerified: true });
      // Verifying a changed address is not a new account.
      if (!isEmailChangeVerification(request)) await queueWelcomeEmail(user.id);
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
  verification: {
    storeIdentifier: { default: "hashed", overrides: { "trust-device-": trustDeviceIdentifier } },
  },
  // Rows sealed before this was on stay readable: Better Auth passes non-hex
  // (plaintext) tokens through and seals them on the user's next sign-in.
  account: { encryptOAuthTokens: true, accountLinking },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    // Off: our step-up (hooks.before) is the freshness control. Better Auth's check would refuse
    // a passkey registration that already passed step-up in an older session; unlink-account,
    // its only other guarded write, needs step-up instead.
    freshAge: 0,
    // Off: with the cache on, a revoked or banned session keeps working on
    // /api/auth/* for its maxAge (see GHSA-fvxx). App reads skip it anyway.
    cookieCache: { enabled: false },
    // --- two-factor + step-up (feat/two-factor) ---
    additionalFields: authMethodSessionField,
    // --- end two-factor + step-up ---
  },
  advanced: {
    ipAddress: authEnv.ipAddress,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Deletes on a single GET; our confirm page posts the token to /delete-user instead.
      if (ctx.path === "/delete-user/callback") throw new APIError("NOT_FOUND");
      // First, so nothing below (a sent email, a counted attempt) happens without a passed check.
      // New early-return branches go below it.
      const passed = await stepUpGate(ctx);
      if (ctx.path === "/sign-in/email") {
        // Counted here, atomically, before the password check; a correct sign-in clears it in `after`.
        const email = signInEmail(ctx.body);
        if (email && !(await allowSignInAttempt(email))) {
          throw new APIError("TOO_MANY_REQUESTS", { message: SIGN_IN_LIMITED_MESSAGE });
        }
        return;
      }
      if (ctx.path === "/unlink-account") {
        await guardUnlink(ctx);
        return;
      }
      if (ctx.path === "/passkey/delete-passkey") {
        await guardPasskeyDelete(ctx);
        return;
      }
      if (ADMIN_GUARDED.has(ctx.path)) {
        await guardAdminEndpoint(ctx);
        return;
      }
      if (ctx.path === "/change-password") {
        // Per user, on top of the per-IP rule: a stolen session can't grind the current password.
        const current = await getSessionFromCtx(ctx);
        if (current && !(await allowPasswordChange(current.user.id))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many password changes. Try again later.",
          });
        }
        return;
      }
      if (ctx.path === "/delete-user" && hasDeleteToken(ctx.body)) {
        // Better Auth spends the token before beforeDelete can refuse; check first so it survives.
        const current = await getSessionFromCtx(ctx);
        if (!current) return;
        const names = await blockingNames(current.user.id);
        if (names.length > 0) throw soleOwnerError(names, "open this link again");
        return;
      }
      if (passed !== "account.change_email" && passed !== "account.delete") return;
      const current = await getSessionFromCtx(ctx);
      if (!current) return;
      // Counts attempts, not sends: Better Auth sends nothing when the new address is taken,
      // so capping only real sends would answer 429 for a free address and 200 for a taken one.
      if (passed === "account.change_email") {
        await limitSignedInEmail("change-email", current.user.email);
        return;
      }
      // Here, not in sendDeleteAccountVerification: Better Auth 1.7.18 logs and drops errors
      // thrown there, so the user would be told "check your email" for nothing.
      const names = await blockingNames(current.user.id);
      if (names.length > 0) throw soleOwnerError(names, "try again");
      await limitSignedInEmail("delete-account", current.user.email);
    }),
    after: createAuthMiddleware(async (ctx) => {
      await factorChangedAfter(ctx, deliver);
      await replaceSessionOnSignIn(ctx);
      if (ctx.path === "/sign-in/email") {
        // Only a successful sign-in (the real password) resets the count.
        const email = signInEmail(ctx.body);
        if (email && !isAPIError(ctx.context.returned)) await clearSignInAttempts(email);
        return;
      }
      const returned = ctx.context.returned as
        { user?: { id: string; email: string }; message?: string } | undefined;
      if (!returned || isAPIError(returned)) return;
      if (ctx.path === "/delete-user" && returned.message === "User deleted") {
        // The token path deletes inside a nested call whose cookie changes never reach the
        // response, so the browser would keep a dead session cookie.
        deleteSessionCookie(ctx);
        return;
      }
      if (ctx.path !== "/change-password" && ctx.path !== "/admin/set-user-password") return;
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
      // The sole-owner check and the per-address cap run in hooks.before.
      sendDeleteAccountVerification: async ({ user, url, token }) => {
        await deliver({
          to: user.email,
          ...deleteAccountEmail(emailContext, {
            url: deleteConfirmUrl(url, token),
            expiresInSeconds: DELETE_TOKEN_SECONDS,
            ...recovery(),
          }),
        });
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
          // Better Auth's approval link is signed with the verification lifetime.
          ...emailChangeEmail(emailContext, {
            currentEmail: user.email,
            newEmail,
            url,
            expiresInSeconds: VERIFY_LINK_SECONDS,
            ...recovery(),
          }),
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
        after: async (user, ctx) => {
          // Personal workspace + owner membership, in one transaction (U4).
          await runtime.runPromise(ensurePersonalWorkspace(user));
          // OAuth sign-ups can arrive already verified.
          await promoteIfBootstrapAdmin(user);
          // Verified at creation (Google, GitHub) or nothing to verify: welcome now. Email sign-ups
          // that must verify are welcomed from afterEmailVerification.
          if (welcomeAtCreation(user, requireEmailVerification)) await queueWelcomeEmail(user.id);
          // The method comes from the endpoint Better Auth ran, never from the request body.
          const provider = (ctx?.params as { id?: unknown } | undefined)?.id;
          track({
            name: "signed_up",
            userId: user.id,
            props: {
              method: signUpMethod(ctx?.path, typeof provider === "string" ? provider : undefined),
            },
          });
        },
      },
      // --- two-factor + step-up (feat/two-factor) ---
      update: { after: twoFactorUserUpdated(deliver) },
      // --- end two-factor + step-up ---
    },
    account: {
      create: { after: accountCreated(deliver) },
      delete: { after: accountDeleted(deliver) },
    },
    session: {
      create: {
        before: async (session, ctx) => {
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
              // two-factor + step-up (feat/two-factor)
              authMethod: authMethodOf(session as { authMethod?: string | null }, ctx),
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
      invitationExpiresIn: INVITATION_SECONDS,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      sendInvitationEmail: async ({ email, invitation, organization, inviter }) => {
        const acceptUrl = `${authEnv.betterAuthUrl}/accept-invitation/${invitation.id}`;
        await deliver({
          to: email,
          ...invitationEmail(emailContext, {
            organizationName: organization.name,
            inviterEmail: inviter.user.email,
            url: acceptUrl,
            expiresInSeconds: INVITATION_SECONDS,
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
    // two-factor + step-up (feat/two-factor)
    twoFactorPlugin(),
    passkeyPlugin(authEnv.betterAuthUrl),
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
