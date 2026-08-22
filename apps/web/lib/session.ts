import { createDb, asc, eq, member } from "@receipt-ocr/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth, authEnabled, type Session } from "./auth";
import { authEnv } from "./env";

/**
 * Single place for server-side session lookups. Returns null when auth is
 * not configured (preview mode) or when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  if (!authEnabled) return null;
  return auth.api.getSession({ headers: await headers() });
}

/** Session user id, or null when signed out / auth not configured. */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ?? null;
}

/** The caller's billing plan, defaulting to "free". */
export function planFor(session: Session | null): string {
  const plan = (session?.user as { plan?: unknown } | undefined)?.plan;
  return typeof plan === "string" && plan ? plan : "free";
}

/** For pages: redirects to /sign-in when there is no session. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/** True when the session user holds the admin role. */
export function isAdmin(session: Session | null): boolean {
  return session?.user.role === "admin";
}

/**
 * For admin pages and server actions: requires a signed-in admin. Redirects
 * anonymous visitors to /sign-in and 404s non-admins (avoids leaking that the
 * admin area exists). Callers must still gate on `authEnabled` for the
 * "not configured" state — this throws/redirects rather than degrading.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!isAdmin(session)) notFound();
  return session;
}

/**
 * The workspace a request acts in, plus who is acting. Receipts are scoped to
 * `organizationId`; `userId` is attribution only.
 *
 * `session.activeOrganizationId` is set by Better Auth on session creation and
 * only ever to an organization the user belongs to, so it is safe to trust as
 * an authorization boundary. The membership lookup below is a fallback for
 * sessions created before that hook existed.
 */
export interface ActiveScope {
  organizationId: string;
  userId: string;
}

export async function getActiveScope(): Promise<ActiveScope | null> {
  const session = await getSession();
  if (!session) return null;

  const active = session.session.activeOrganizationId;
  if (active) return { organizationId: active, userId: session.user.id };

  if (!authEnv.databaseUrl) return null;
  const db = createDb(authEnv.databaseUrl);
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(member.createdAt))
    .limit(1);

  if (!membership) return null;
  return { organizationId: membership.organizationId, userId: session.user.id };
}

/** For pages: requires a signed-in user who is in a workspace. */
export async function requireActiveScope(): Promise<ActiveScope> {
  const scope = await getActiveScope();
  if (!scope) redirect("/sign-in");
  return scope;
}
