import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth, authEnabled, type Session } from "./auth";

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
