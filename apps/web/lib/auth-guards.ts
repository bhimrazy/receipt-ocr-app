import "server-only";
import { hitRateLimit, parseWorkspaceName, WORKSPACE_ROLES } from "@receipt-ocr/core";
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
 * one of our roles. Better Auth 1.7.14 accepts comma lists with padding such as
 * "admin, owner" (GHSA-c85h), which would let a workspace admin mint an owner.
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
