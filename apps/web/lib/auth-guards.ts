import "server-only";
import {
  hitRateLimit,
  parseWorkspaceName,
  WORKSPACE_ROLES,
  workspaceCreationCheck,
  userPaysForWorkspace,
  workspaceHasChargingSubscription,
} from "@receipt-ocr/core";
import { APIError } from "better-auth/api";
import { runtime } from "./runtime";

/** Invitations one user may send per hour, across all their workspaces. */
export const INVITES_PER_HOUR = 10;

/**
 * Better Auth organization hook: rejects unsafe workspace names with 400 and
 * stores the trimmed one. Updates that leave the name alone pass through.
 */
export async function validateWorkspaceName<T extends { name?: string }>(
  organization: T,
  { required }: { required: boolean },
): Promise<{ data: T } | void> {
  if (!required && organization.name === undefined) return;
  const parsed = parseWorkspaceName(organization.name);
  if (!parsed.ok) throw new APIError("BAD_REQUEST", { message: parsed.error });
  return { data: { ...organization, name: parsed.name } };
}

const ROLES: ReadonlySet<string> = new Set(WORKSPACE_ROLES);

/**
 * Better Auth organization hook: a membership or invitation role must be exactly
 * one of our roles, never a comma list such as "admin,owner" (GHSA-c85h: it would
 * let a workspace admin mint an owner). Better Auth 1.7.16+ trims roles before this runs.
 */
export function assertWorkspaceRole(role: unknown): void {
  if (typeof role !== "string" || !ROLES.has(role)) {
    throw new APIError("BAD_REQUEST", { message: "Choose member, admin or owner." });
  }
}

/**
 * Per-inviter cap on invitations. Better Auth's own limiter keys on IP only,
 * so without this one account could mail hundreds of addresses from rotating IPs.
 */
export async function limitInvitations(inviterId: string): Promise<void> {
  const { allowed, retryAfterSeconds } = await runtime.runPromise(
    hitRateLimit(`invite:${inviterId}`, 60 * 60 * 1000, INVITES_PER_HOUR),
  );
  if (!allowed) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { message: "Too many invitations. Try again later." },
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
}

/**
 * Better Auth organization hook: refuses a workspace past the creator's
 * ownership cap (Free 1, Pro 2) with a message that says why. This is the
 * server-side check; the switcher only hides the button.
 */
export async function assertCanCreateWorkspace(userId: string): Promise<void> {
  const check = await runtime.runPromise(workspaceCreationCheck(userId));
  if (!check.allowed) throw new APIError("FORBIDDEN", { message: check.message ?? undefined });
}

/**
 * Better Auth organization hooks and the leave path: the buyer of a
 * subscription that can still charge can't be removed, demoted or leave,
 * because only they can cancel it in the app.
 */
export async function assertBuyerStays(
  organizationId: string,
  userId: string,
  name: string,
  action: "remove" | "demote" | "leave",
): Promise<void> {
  if (!(await runtime.runPromise(userPaysForWorkspace(organizationId, userId)))) return;
  const message =
    action === "leave"
      ? "You pay for Pro on this workspace. Cancel the subscription in Billing, or let it end, before leaving."
      : `${name} pays for Pro on this workspace. Cancel the subscription in Billing, or let it end, before ${
          action === "remove" ? "removing them" : "changing their role"
        }.`;
  throw new APIError("BAD_REQUEST", { message });
}

/**
 * Better Auth organization hook: a workspace whose subscription can still
 * charge (anything but canceled, unless the cancel is already scheduled; so
 * also past_due after its grace, paused and trialing) can't be deleted, or
 * Paddle would keep charging for a workspace that is gone.
 */
export async function assertNoLiveSubscription(organizationId: string): Promise<void> {
  if (await runtime.runPromise(workspaceHasChargingSubscription(organizationId))) {
    throw new APIError("BAD_REQUEST", {
      message: "Cancel this workspace's Pro subscription in Settings, Billing before deleting it.",
    });
  }
}
