import { and, createDb, eq, member, organization, schema } from "@receipt-ocr/db";
import {
  invitationEmail,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from "@receipt-ocr/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { authEnabled, authEnv, emailEnv } from "./env";
import { workspaceLimitForPlan } from "./plans";

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

/** Resend when configured; otherwise every message is logged with its link. */
const mailer = { apiKey: emailEnv.resendApiKey, from: emailEnv.from };

function slugForUser(userId: string) {
  return userId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function workspaceNameFor(user: { name: string; email: string }) {
  const base = user.name?.trim() || user.email.split("@")[0] || "Personal";
  return `${base}'s Workspace`;
}

export const auth = betterAuth({
  appName: "receiptOCR",
  baseURL: authEnv.betterAuthUrl,
  secret: authEnv.betterAuthSecret ?? PLACEHOLDER_SECRET,
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
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(mailer, { to: user.email, ...passwordResetEmail(url) });
    },
  },
  emailVerification: {
    // Sent on sign-up, but not required to use the app: blocking an unverified
    // user before any email provider is guaranteed to be configured would lock
    // people out of their own accounts.
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(mailer, { to: user.email, ...verificationEmail(url) });
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
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
    },
  },
  user: {
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
        // Bootstrap the first admin(s): any signup whose email is listed in
        // ADMIN_EMAILS is created with the "admin" role. Existing users must be
        // promoted via the admin panel or SQL (see .env.example).
        before: async (user) => {
          if (authEnv.adminEmails.includes(user.email.toLowerCase())) {
            return { data: { ...user, role: "admin" } };
          }
          return undefined;
        },
        after: async (user) => {
          // Every new user gets a personal workspace they own.
          const orgId = crypto.randomUUID();
          const now = new Date();
          await db.insert(organization).values({
            id: orgId,
            name: workspaceNameFor(user),
            slug: slugForUser(user.id),
            createdAt: now,
          });
          await db.insert(member).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: user.id,
            role: "owner",
            createdAt: now,
          });
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
      sendInvitationEmail: async ({ email, invitation, organization, inviter }) => {
        const acceptUrl = `${authEnv.betterAuthUrl}/accept-invitation/${invitation.id}`;
        await sendEmail(mailer, {
          to: email,
          ...invitationEmail({
            organizationName: organization.name,
            inviterEmail: inviter.user.email,
            url: acceptUrl,
          }),
        });
      },
      // Returns true when the user has REACHED their plan's org limit.
      organizationLimit: async (user) => {
        const limit = workspaceLimitForPlan(typeof user.plan === "string" ? user.plan : "free");
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
    // Keep nextCookies last so it can pick up Set-Cookie from server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = typeof auth.$Infer.Session.user;
