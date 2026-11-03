"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";

/**
 * Server-only admin mutations. Every action re-verifies the caller is an admin
 * via requireAdmin() before touching auth.api — the client is never trusted.
 * The Better Auth admin plugin ALSO enforces the role on each endpoint, so
 * this is defense in depth.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Re-check admin, then hand back the request headers to forward the session. */
async function adminHeaders(): Promise<Headers> {
  await requireAdmin();
  return headers();
}

function toResult(error: unknown): ActionResult {
  if (error instanceof APIError) {
    return { ok: false, error: error.message };
  }
  const message = error instanceof Error ? error.message : "Something went wrong";
  return { ok: false, error: message };
}

export async function setRoleAction(userId: string, role: "user" | "admin"): Promise<ActionResult> {
  try {
    await auth.api.setRole({ body: { userId, role }, headers: await adminHeaders() });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function banUserAction(
  userId: string,
  banReason?: string,
  banExpiresInSeconds?: number,
): Promise<ActionResult> {
  try {
    await auth.api.banUser({
      body: {
        userId,
        ...(banReason ? { banReason } : {}),
        ...(banExpiresInSeconds ? { banExpiresIn: banExpiresInSeconds } : {}),
      },
      headers: await adminHeaders(),
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function unbanUserAction(userId: string): Promise<ActionResult> {
  try {
    await auth.api.unbanUser({ body: { userId }, headers: await adminHeaders() });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function revokeUserSessionsAction(userId: string): Promise<ActionResult> {
  try {
    await auth.api.revokeUserSessions({ body: { userId }, headers: await adminHeaders() });
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Takes the session id, not the token: tokens are bearer credentials and must
 * never reach the browser (security review L1). The token is looked up here,
 * after the admin check, scoped to the given user.
 */
export async function revokeUserSessionAction(sessionId: string, userId: string): Promise<ActionResult> {
  try {
    const requestHeaders = await adminHeaders();
    const result = await auth.api.listUserSessions({ body: { userId }, headers: requestHeaders });
    const sessions = "sessions" in result ? result.sessions : [];
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return { ok: false, error: "That session has already ended." };
    await auth.api.revokeUserSession({ body: { sessionToken: target.token }, headers: requestHeaders });
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function removeUserAction(userId: string): Promise<ActionResult> {
  try {
    await auth.api.removeUser({ body: { userId }, headers: await adminHeaders() });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Start impersonating a user. The admin plugin swaps the current cookie for an
 * impersonation session (session.impersonatedBy = admin id); the nextCookies
 * plugin writes the Set-Cookie header from within this server action. We then
 * redirect into the app as the impersonated user.
 */
export async function impersonateUserAction(userId: string): Promise<ActionResult> {
  try {
    await auth.api.impersonateUser({ body: { userId }, headers: await adminHeaders() });
  } catch (error) {
    return toResult(error);
  }
  redirect("/app");
}
