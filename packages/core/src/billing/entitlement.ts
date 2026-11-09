import type { AdjustmentSnapshot, BillingStatus } from "./provider";

/**
 * Which subscription states grant Pro. Pure: the queries that apply this rule
 * (`workspacePlan`, `accountPlan`, `entitledSql`) are in service.ts.
 */

/**
 * Pro keeps working this long after a renewal payment fails, while the provider retries the card.
 * Matches Paddle Retain's default 30-day dunning window, so Pro doesn't end while Paddle can still
 * recover the payment (https://developer.paddle.com/concepts/retain/payment-recovery-dunning).
 */
export const PAST_DUE_GRACE_DAYS = 30;
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type EntitlementFields = {
  status: BillingStatus;
  priceId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  /** Set by a chargeback or a full refund: Pro ends at once, whatever the status says. */
  revokedAt: Date | null;
};

/**
 * Whether a stored subscription grants Pro at `now`. Only for a Pro price
 * (`proPrices`, from config) and never once revoked; then by status:
 * - active or trialing, unless a cancellation scheduled for the period end has passed
 *   (in case the final `canceled` event is late or lost);
 * - past_due, for `PAST_DUE_GRACE_DAYS` from when it first failed;
 * - canceled with a period end still ahead and the cancel scheduled for it;
 * - never paused.
 * `entitledSql` in service.ts is the same rule for queries; billing.int.test.ts keeps them in step.
 */
export function isEntitled(
  s: EntitlementFields,
  now: Date,
  proPrices: ReadonlySet<string>,
): boolean {
  if (s.revokedAt !== null || s.priceId === null || !proPrices.has(s.priceId)) return false;
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

/**
 * Whether a subscription can still charge: anything but `canceled`, except an
 * active or trialing one whose cancellation is already scheduled. Its workspace
 * (and its owner's account) can't be deleted while one can, or the provider
 * would keep billing for something that is gone. `chargingSql` in service.ts is
 * the same rule.
 */
export function canStillCharge(s: Pick<EntitlementFields, "status" | "cancelAtPeriodEnd">) {
  if (s.status === "canceled") return false;
  return !((s.status === "active" || s.status === "trialing") && s.cancelAtPeriodEnd);
}

/**
 * Whether an adjustment ends Pro for its subscription: an approved chargeback,
 * or an approved refund of a whole transaction. Partial refunds and credits don't.
 */
export function adjustmentRevokesPro(a: AdjustmentSnapshot): boolean {
  if (a.status !== "approved" || !a.subscriptionId) return false;
  return a.action === "chargeback" || (a.action === "refund" && a.type === "full");
}

/** Why a new workspace is refused, for the account plan the creator is on. */
export function workspaceLimitMessage(plan: "free" | "pro", limit: number): string {
  const workspaces = `${limit} ${limit === 1 ? "workspace" : "workspaces"}`;
  return plan === "pro"
    ? `You own ${workspaces}, the most on Pro. Delete one, or use the support button if you need more.`
    : `Free accounts can own ${workspaces}. Upgrade a workspace you own to Pro to create another. A new workspace starts on Free.`;
}

/**
 * Why a workspace can't take another member. `invite` is shown to whoever is
 * inviting (an owner or admin, who can act on it); `accept` to the invitee.
 */
export function memberLimitMessage(
  plan: "free" | "pro",
  limit: number,
  proLimit: number,
  when: "invite" | "accept",
): string {
  const members = `${limit} ${limit === 1 ? "member" : "members"}`;
  if (when === "accept") {
    return plan === "pro"
      ? `This workspace already has ${members}, the most on Pro. Ask its owner to make room.`
      : `This workspace already has ${members}, the most on Free. Ask its owner to upgrade it to Pro, or to make room.`;
  }
  return plan === "pro"
    ? `Pro workspaces have up to ${members}, counting pending invitations. Cancel an invitation or remove a member, or use the support button if you need more.`
    : `Free workspaces have up to ${members}, counting pending invitations. Upgrade this workspace to Pro for up to ${proLimit}, or cancel an invitation or remove a member.`;
}
