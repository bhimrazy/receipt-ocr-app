import { and, createDb, eq, member, organization, schema } from "@receipt-ocr/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { authEnabled, authEnv } from "./env";

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

/** Max organizations a user may create, by plan. Paid plans raise this later. */
const ORGANIZATION_LIMITS: Record<string, number> = {
  free: 1,
};

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
    // Email delivery is stubbed to the server log until an email provider is
    // wired up (later phase). The URL in the log is a working reset link.
    sendResetPassword: async ({ user, url }) => {
      console.info(`[auth] Password reset requested for ${user.email}: ${url}`);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      console.info(`[auth] Email verification for ${user.email}: ${url}`);
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
      // Email delivery is stubbed to the server log until an email provider is
      // wired up (later phase). The accept URL in the log is a working invite
      // link; the Members UI also surfaces a copyable version of it.
      sendInvitationEmail: async ({ email, invitation, organization, inviter }) => {
        const acceptUrl = `${authEnv.betterAuthUrl}/accept-invitation/${invitation.id}`;
        console.info(
          `[auth] ${inviter.user.email} invited ${email} to "${organization.name}": ${acceptUrl}`,
        );
      },
      // Returns true when the user has REACHED their plan's org limit.
      organizationLimit: async (user) => {
        const plan = typeof user.plan === "string" ? user.plan : "free";
        const limit = ORGANIZATION_LIMITS[plan] ?? ORGANIZATION_LIMITS.free;
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
