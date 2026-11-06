import "server-only";
import {
  DEFAULT_PLANS,
  ensurePersonalWorkspace,
  policyFor,
  prepareUserDeletion,
  purgeReceiptFiles,
  userPlan,
} from "@receipt-ocr/core";
import { and, createDb, eq, member, schema, user as userTable } from "@receipt-ocr/db";
import {
  invitationEmail,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
  type SendEmailInput,
} from "@receipt-ocr/email";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { captcha } from "better-auth/plugins/captcha";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { isBootstrapAdmin } from "./admin-bootstrap";
import { limitInvitations, validateWorkspaceName } from "./auth-guards";
import {
  authEnabled,
  authEnv,
  emailEnv,
  isProduction,
  requireEmailVerification,
  turnstileEnv,
} from "./env";
import { logger } from "./log";
import { runtime } from "./runtime";

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
  logUndelivered: process.env.NODE_ENV === "development",
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
  logger.info({ event: "receipt.files_purged", ...owner, count: purged });
}

/**
 * Before a user row goes: deletes the workspaces only they belong to (files
 * first) and refuses while they own a shared workspace with no other owner.
 * Shared-workspace receipts they uploaded stay, with no uploader.
 */
export async function deleteOwnData(userId: string) {
  const exit = await runtime.runPromiseExit(prepareUserDeletion(userId));
  if (exit._tag === "Success") {
    logger.info({ event: "user.data_deleted", userId, ...exit.value });
    return exit.value;
  }
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
  if (failure?._tag === "Conflict") throw new APIError("BAD_REQUEST", { message: failure.message });
  throw new Error("Could not delete the user's workspaces", { cause: exit.cause });
}

/** The plugin's defaults (sign-up, sign-in, password reset) plus the resend-confirmation link. */
const CAPTCHA_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/send-verification-email",
];

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
  trustedOrigins: [authEnv.betterAuthUrl],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    requireEmailVerification,
    sendResetPassword: async ({ user, url }) => {
      await deliver({ to: user.email, ...passwordResetEmail(url) });
    },
  },
  emailVerification: {
    // Dev logs the link; in production a send without a mailer throws, so only send when required.
    sendOnSignUp: requireEmailVerification || !isProduction,
    sendOnSignIn: requireEmailVerification,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
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
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      // Per IP; auth-guards also caps each inviter.
      "/organization/invite-member": { window: 60 * 60, max: 20 },
    },
  },
  // Reset and verification tokens are stored as hashes: a database read alone can't use them.
  verification: { storeIdentifier: "hashed" },
  // Rows sealed before this was on stay readable: Better Auth passes non-hex
  // (plaintext) tokens through and seals them on the user's next sign-in.
  account: { encryptOAuthTokens: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  advanced: {
    ipAddress: authEnv.ipAddress,
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteOwnData(user.id);
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
        beforeCreateInvitation: ({ inviter }) => limitInvitations(inviter.id),
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
          }),
        ]
      : []),
    // Keep nextCookies last so it can pick up Set-Cookie from server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
