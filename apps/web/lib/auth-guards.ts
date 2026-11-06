import "server-only";
import { hitRateLimit, parseWorkspaceName } from "@receipt-ocr/core";
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
