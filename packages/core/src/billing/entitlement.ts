import type { BillingStatus } from "./provider";

/**
 * Which subscription states grant Pro. Pure: the queries that apply this rule
 * (`workspacePlan`, `accountPlan`, `entitledSql`) are in service.ts.
 */

/** Pro keeps working this long after a renewal payment fails, while the provider retries the card. */
export const PAST_DUE_GRACE_DAYS = 14;
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type EntitlementFields = {
  status: BillingStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
};

/**
 * Whether a stored subscription grants Pro at `now`:
 * - active or trialing, unless a cancellation scheduled for the period end has passed
 *   (in case the final `canceled` event is late or lost);
 * - past_due, for `PAST_DUE_GRACE_DAYS` from when it first failed;
 * - canceled with a period end still ahead and the cancel scheduled for it;
 * - never paused.
 * `entitledSql` in service.ts is the same rule for queries; billing.int.test.ts keeps them in step.
 */
export function isEntitled(s: EntitlementFields, now: Date): boolean {
  const periodAhead = s.currentPeriodEnd !== null && s.currentPeriodEnd > now;
  switch (s.status) {
    case "active":
    case "trialing":
      return !s.cancelAtPeriodEnd || s.currentPeriodEnd === null || periodAhead;
    case "past_due":
      return (
        s.pastDueSince !== null && now.getTime() - s.pastDueSince.getTime() < PAST_DUE_GRACE_MS
      );
    case "canceled":
      return s.cancelAtPeriodEnd && periodAhead;
    case "paused":
      return false;
  }
}

/** Why a new workspace is refused, for the account plan the creator is on. */
export function workspaceLimitMessage(plan: "free" | "pro", limit: number): string {
  const workspaces = `${limit} ${limit === 1 ? "workspace" : "workspaces"}`;
  return plan === "pro"
    ? `You already own ${workspaces}, the most a Pro account can own. Delete one, or ask an admin for more.`
    : `Free accounts can own ${workspaces}. Upgrade a workspace you own to Pro to create another. A new workspace starts on Free.`;
}
