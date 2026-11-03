import "server-only";
import { ensurePersonalWorkspace, resolveScope } from "@receipt-ocr/core";
import { Effect } from "effect";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, authEnabled, type Session } from "./auth";
import { runtime } from "./runtime";

/**
 * Single place for server-side session lookups, deduplicated per request.
 * Returns null when auth is not configured (preview mode) or there is no
 * valid session.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!authEnabled) return null;
  return auth.api.getSession({ headers: await headers() });
});

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
 * The workspace a request acts in, plus who is acting and their role.
 * Receipts are scoped to `organizationId`; `userId` is attribution only.
 *
 * Resolved through `member` on every request (deduplicated per request):
 * `session.activeOrganizationId` is only a preference, because Better Auth
 * leaves it set on a removed member's sessions.
 */
export interface ActiveScope {
  organizationId: string;
  userId: string;
  role: string;
}

export const getActiveScope = cache(async (): Promise<ActiveScope | null> => {
  const session = await getSession();
  if (!session) return null;
  const { user } = session;
  return runtime.runPromise(
    Effect.gen(function* () {
      const scope = yield* resolveScope(user.id, session.session.activeOrganizationId);
      if (scope) return scope;
      // Self-heals a sign-up whose workspace bootstrap failed.
      if (!(yield* ensurePersonalWorkspace(user))) return null;
      return yield* resolveScope(user.id);
    }),
  );
});

/** For pages: requires a signed-in user who is in a workspace. */
export async function requireActiveScope(): Promise<ActiveScope> {
  const scope = await getActiveScope();
  if (!scope) redirect("/sign-in");
  return scope;
}
