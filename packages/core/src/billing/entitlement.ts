import type { AdjustmentSnapshot, BillingStatus, TransactionLine } from "./provider";

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
  /** Recorded when the subscription linked; see `billing_subscriptions.plan`. */
  plan: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  /** Set by a chargeback or a full refund: Pro ends at once, whatever the status says. */
  revokedAt: Date | null;
};

/**
 * Whether a stored subscription grants Pro at `now`. Only for a subscription
 * linked as Pro (the price is checked once, at the link, so a change to the
 * configured prices never moves a paying workspace) and never once revoked;
 * then by status:
 * - active or trialing, unless a cancellation scheduled for the period end has passed
 *   (in case the final `canceled` event is late or lost);
 * - past_due, for `PAST_DUE_GRACE_DAYS` from when it first failed;
 * - canceled with a period end still ahead and the cancel scheduled for it;
 * - never paused.
 * `entitledSql` in service.ts is the same rule for queries; billing.int.test.ts keeps them in step.
 */
export function isEntitled(s: EntitlementFields, now: Date): boolean {
  if (s.revokedAt !== null || s.plan !== "pro") return false;
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
 * Whether a subscription blocks a new checkout for its workspace, so a second
 * one can't charge alongside it. Every entitling row blocks, and so do three
 * that grant nothing but can still charge, each explained on Plan and billing:
 * past_due after the grace (Paddle may still recover the payment), paused, and
 * an active or trialing row revoked by a refund or chargeback whose cancel is
 * still owed. A canceled row blocks only while it still grants Pro.
 * `checkoutBlockingSql` in service.ts is the same rule.
 */
export function blocksCheckout(s: EntitlementFields, now: Date): boolean {
  if (isEntitled(s, now)) return true;
  switch (s.status) {
    case "active":
    case "trialing":
      return s.revokedAt !== null;
    case "past_due":
    case "paused":
      return true;
    case "canceled":
      return false;
  }
}

/**
 * Whether an adjustment can end Pro: an approved chargeback, or an approved
 * refund of a whole transaction. Partial refunds and credits never do.
 */
export function adjustmentMayRevoke(a: AdjustmentSnapshot): boolean {
  if (a.status !== "approved" || !a.subscriptionId) return false;
  return a.action === "chargeback" || (a.action === "refund" && a.type === "full");
}

/**
 * Whether an adjustment ends Pro for its subscription, given the transaction
 * paying for its current period: any approved chargeback, or a full refund
 * of that transaction. A full refund of another one (an earlier period, a
 * duplicate charge, a one-off) leaves Pro and the subscription alone.
 */
export function adjustmentRevokesPro(
  a: AdjustmentSnapshot,
  paidTransactionId: string | null,
): boolean {
  if (!adjustmentMayRevoke(a)) return false;
  if (a.action === "chargeback") return true;
  return a.transactionId !== null && a.transactionId === paidTransactionId;
}

/**
 * Transaction origins that pay for a billing period. Not `subscription_charge`
 * (a one-off charge) or `subscription_payment_method_change` (a card check).
 */
const PERIOD_ORIGINS: ReadonlySet<string> = new Set(["web", "api", "subscription_recurring"]);

type PeriodTransaction = {
  origin: string | null;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  lines: readonly TransactionLine[] | null;
};

/** The stored subscription's current billing period. */
type StoredPeriod = { start: Date | null; end: Date | null };

const sameTime = (a: Date | null, b: Date | null) =>
  a !== null && b !== null && a.getTime() === b.getTime();

/**
 * Whether a `subscription_update` charges a full price, from the provider's
 * proration markers: some item with a positive quantity isn't prorated. A
 * price or interval change billed at once has one (the new price, beside a
 * prorated credit for the old one); a change inside the period, such as a
 * moved billing date, has only prorated items. Null when the items are unknown.
 */
function chargesFullPrice(lines: readonly TransactionLine[] | null): boolean | null {
  if (lines === null || lines.length === 0) return null;
  return lines.some((line) => line.quantity > 0 && !line.prorated);
}

/**
 * The rule for a `subscription_update` stored without its items: a proration
 * ends where the stored period does but starts elsewhere. Paddle's transaction
 * period is the subscription's whole period, not the prorated part (sandbox,
 * checked 2026-11-14), so a change inside the period usually passes here and
 * is caught by `paysNewerPeriod`'s start check instead.
 */
function isLegacyProration(t: PeriodTransaction, period: StoredPeriod): boolean {
  return sameTime(t.billingPeriodEnd, period.end) && !sameTime(t.billingPeriodStart, period.start);
}

/**
 * Whether a completed transaction pays for a billing period: a checkout or a
 * renewal, or a `subscription_update` that charges a full price
 * (`chargesFullPrice`, else the stored-period rule for items we don't know).
 * Not a one-off charge, a card check or a proration.
 */
export function paysPeriod(t: PeriodTransaction, period: StoredPeriod): boolean {
  if (!t.origin || !t.billingPeriodStart) return false;
  if (t.origin === "subscription_update") {
    return chargesFullPrice(t.lines) ?? !isLegacyProration(t, period);
  }
  return PERIOD_ORIGINS.has(t.origin);
}

/**
 * Whether a completed transaction now pays for its subscription's current
 * period: it pays for a period (`paysPeriod`), and that period starts after
 * the recorded one. A second transaction for the same period (a duplicate
 * charge) doesn't replace the first. A `subscription_update` counts only
 * after a recorded period.
 */
export function paysNewerPeriod(
  t: PeriodTransaction,
  recordedStart: Date | null,
  period: StoredPeriod,
): boolean {
  if (!paysPeriod(t, period)) return false;
  if (recordedStart === null) return t.origin !== "subscription_update";
  return t.billingPeriodStart !== null && t.billingPeriodStart > recordedStart;
}

/**
 * The plan a price buys: Pro for the configured Pro prices (`prices`), else
 * null for a price this deploy doesn't know. Only Pro is sold today.
 */
export function planForPrice(priceId: string | null, prices: ReadonlySet<string>): "pro" | null {
  return priceId !== null && prices.has(priceId) ? "pro" : null;
}

/**
 * Why a new workspace is refused, for the account plan the creator is on. These messages state
 * the limits and what the reader can do now; they never ask for an upgrade, since they are shown
 * without a control and whatever the checkout state.
 */
export function workspaceLimitMessage(plan: "free" | "pro", limit: number): string {
  const workspaces = `${limit} ${limit === 1 ? "workspace" : "workspaces"}`;
  return plan === "pro"
    ? `You own ${workspaces}, the most on Pro. Delete one, or use the support button if you need more.`
    : `Free accounts can own ${workspaces}. A new workspace starts on Free.`;
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
      : `This workspace already has ${members}, the most on Free. Ask its owner to make room.`;
  }
  return plan === "pro"
    ? `Pro workspaces have up to ${members}, counting pending invitations. Cancel an invitation or remove a member, or use the support button if you need more.`
    : `Free workspaces have up to ${members}, counting pending invitations, and Pro workspaces up to ${proLimit}. Cancel an invitation or remove a member to make room.`;
}
