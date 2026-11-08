/**
 * Account deletion by emailed link. Shared by the Better Auth hooks (lib/auth.ts) and the
 * settings UI, so it must stay free of server-only imports.
 */

/** Lifetime of an emailed account-deletion link (`user.deleteUser.deleteTokenExpiresIn`). */
export const DELETE_TOKEN_SECONDS = 60 * 60;

/** Settings page the deletion email links to; it posts the token back to `/delete-user`. */
export const DELETE_CONFIRM_PATH = "/app/settings/delete-account";

/**
 * A `/delete-user` call carrying the emailed token completes a deletion; one without only
 * requests the link. Opening the link already proves the inbox, so completing needs no step-up.
 */
export function hasDeleteToken(body: unknown): boolean {
  const token = (body as { token?: unknown } | null | undefined)?.token;
  return typeof token === "string" && token.length > 0;
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

/**
 * Why the account can't be deleted yet: a Pro subscription that can still charge would be left
 * with no one to cancel it. Billing lives in each workspace's own settings.
 */
export function cancelSubscriptionFirst(workspaces: readonly string[]): string {
  const names =
    workspaces.length <= 1
      ? (workspaces[0] ?? "a workspace")
      : `${workspaces.slice(0, -1).join(", ")} and ${workspaces.at(-1)}`;
  return `Cancel the Pro subscription for ${names} first`;
}

/** The server's refusal, without the settings link the UI adds. */
export const subscriptionMessage = (workspaces: readonly string[]) =>
  `${cancelSubscriptionFirst(workspaces)}, in that workspace's Settings, under Billing.`;

export const WORKSPACE_HAS_SUBSCRIPTION = "WORKSPACE_HAS_SUBSCRIPTION";
