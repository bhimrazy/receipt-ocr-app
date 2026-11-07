/**
 * Step-up rules for account changes an attacker with a stolen session would want: requesting
 * account deletion and changing the email. Shared by the Better Auth hook (lib/auth.ts) and the
 * settings UI, so it must stay free of server-only imports.
 */

/** How long after sign-in a session may make those changes (Better Auth `session.freshAge`). */
export const FRESH_AGE_SECONDS = 15 * 60;

/** Lifetime of an emailed account-deletion link (`user.deleteUser.deleteTokenExpiresIn`). */
export const DELETE_TOKEN_SECONDS = 60 * 60;

/** Better Auth's error code for a session older than `freshAge`. */
export const SESSION_NOT_FRESH = "SESSION_NOT_FRESH";

/** Settings page the deletion email links to; it posts the token back to `/delete-user`. */
export const DELETE_CONFIRM_PATH = "/app/settings/delete-account";

function hasToken(body: unknown): boolean {
  const token = (body as { token?: unknown } | null | undefined)?.token;
  return typeof token === "string" && token.length > 0;
}

/**
 * Better Auth checks `freshAge` only on list-sessions, unlink-account and a delete-user call
 * without a password or emailed confirmation; change-email never. A delete that carries the
 * emailed token is exempt: opening the link already proves the inbox.
 */
export function needsFreshSession(path: string | undefined, body: unknown): boolean {
  if (path === "/change-email") return true;
  if (path === "/delete-user") return !hasToken(body);
  return false;
}

export function isSessionFresh(
  createdAt: Date | string,
  now: number = Date.now(),
  freshAgeSeconds: number = FRESH_AGE_SECONDS,
): boolean {
  return now - new Date(createdAt).getTime() < freshAgeSeconds * 1000;
}

/** Our confirmation page on the same origin as Better Auth's own link. */
export function deleteConfirmUrl(betterAuthLink: string, token: string): string {
  const url = new URL(DELETE_CONFIRM_PATH, betterAuthLink);
  url.searchParams.set("token", token);
  return url.toString();
}

/** Better Auth's deletion tokens: 32 characters of 0-9 and a-z. */
export function isDeleteToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-z]{32}$/.test(value);
}

/** Why the account can't be deleted yet, naming the shared workspaces the user alone owns. */
export function soleOwnerMessage(workspaces: readonly string[], then: string): string {
  const names =
    workspaces.length <= 1
      ? (workspaces[0] ?? "a workspace")
      : `${workspaces.slice(0, -1).join(", ")} and ${workspaces.at(-1)}`;
  const which = workspaces.length > 1 ? "which have" : "which has";
  const owner = workspaces.length > 1 ? "an owner of each" : "an owner";
  return `You own ${names}, ${which} other members. Make one of them ${owner}, then ${then}.`;
}

export const WORKSPACE_NEEDS_OWNER = "WORKSPACE_NEEDS_OWNER";
