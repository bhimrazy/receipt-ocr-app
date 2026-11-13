import { BILLING_STATUSES } from "@receipt-ocr/db";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUSES } from "../../src/billing/provider";
import { parseProPriceIds } from "../../src/billing/config";
import {
  adjustmentRevokesPro,
  blocksCheckout,
  canStillCharge,
  isEntitled,
  memberLimitMessage,
  PAST_DUE_GRACE_DAYS,
  paysNewerPeriod as paysNewer,
  planForPrice,
  workspaceLimitMessage,
  type EntitlementFields,
} from "../../src/billing/entitlement";

const now = new Date("2026-11-08T12:00:00Z");
const day = 86_400_000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);
const sub = (fields: Partial<EntitlementFields>): EntitlementFields => ({
  status: "active",
  plan: "pro",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: at(20),
  pastDueSince: null,
  revokedAt: null,
  ...fields,
});

describe("isEntitled (subscription state to plan)", () => {
  it("grants Pro only for a subscription linked as Pro, and never once revoked", () => {
    expect(isEntitled(sub({}), now)).toBe(true);
    expect(isEntitled(sub({ plan: "free" }), now)).toBe(false);
    expect(isEntitled(sub({ revokedAt: at(-1) }), now)).toBe(false);
  });

  it("grants Pro while active or trialing", () => {
    expect(isEntitled(sub({}), now)).toBe(true);
    expect(isEntitled(sub({ status: "trialing" }), now)).toBe(true);
    // A renewal webhook that is late doesn't drop a paying workspace to Free.
    expect(isEntitled(sub({ currentPeriodEnd: at(-2) }), now)).toBe(true);
  });

  it("keeps Pro until the period end after a cancel at period end", () => {
    expect(isEntitled(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(3) }), now)).toBe(true);
    // The period is over and the final `canceled` event is late: Free.
    expect(isEntitled(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-0.01) }), now)).toBe(
      false,
    );
    expect(
      isEntitled(
        sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(3) }),
        now,
      ),
    ).toBe(true);
  });

  it("ends Pro at once on an immediate cancel, and while paused", () => {
    expect(isEntitled(sub({ status: "canceled", currentPeriodEnd: at(10) }), now)).toBe(false);
    expect(
      isEntitled(
        sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) }),
        now,
      ),
    ).toBe(false);
    expect(isEntitled(sub({ status: "paused" }), now)).toBe(false);
  });

  it(`gives a past_due subscription ${PAST_DUE_GRACE_DAYS} days of grace`, () => {
    // Paddle Retain's default dunning window; Pro must outlast its retries.
    expect(PAST_DUE_GRACE_DAYS).toBe(30);
    expect(isEntitled(sub({ status: "past_due", pastDueSince: at(-1) }), now)).toBe(true);
    expect(isEntitled(sub({ status: "past_due", pastDueSince: at(-29) }), now)).toBe(true);
    expect(
      isEntitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS + 0.01) }), now),
    ).toBe(true);
    expect(
      isEntitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS) }), now),
    ).toBe(false);
    expect(isEntitled(sub({ status: "past_due", pastDueSince: null }), now)).toBe(false);
  });
});

describe("parseProPriceIds", () => {
  it("collects monthly, yearly and legacy ids, ignoring blanks", () => {
    expect(
      parseProPriceIds({
        PADDLE_PRICE_PRO_MONTHLY: " pri_m ",
        PADDLE_PRICE_PRO_YEARLY: "pri_y",
        PADDLE_PRICE_PRO_LEGACY: "pri_old1, ,pri_old2",
      }),
    ).toEqual(new Set(["pri_m", "pri_y", "pri_old1", "pri_old2"]));
    expect(parseProPriceIds({})).toEqual(new Set());
  });
});

describe("canStillCharge (deletion guard)", () => {
  it("is false only once canceled, or with the cancel already scheduled", () => {
    expect(canStillCharge({ status: "active", cancelAtPeriodEnd: false })).toBe(true);
    expect(canStillCharge({ status: "trialing", cancelAtPeriodEnd: false })).toBe(true);
    expect(canStillCharge({ status: "past_due", cancelAtPeriodEnd: false })).toBe(true);
    expect(canStillCharge({ status: "paused", cancelAtPeriodEnd: false })).toBe(true);
    expect(canStillCharge({ status: "active", cancelAtPeriodEnd: true })).toBe(false);
    expect(canStillCharge({ status: "canceled", cancelAtPeriodEnd: false })).toBe(false);
  });
});

describe("blocksCheckout (no second subscription)", () => {
  const blocks = (fields: Partial<EntitlementFields>) => blocksCheckout(sub(fields), now);
  it("blocks wherever the subscription grants Pro", () => {
    for (const fields of [
      {},
      { status: "trialing" as const },
      { cancelAtPeriodEnd: true, currentPeriodEnd: at(3) },
      { status: "past_due" as const, pastDueSince: at(-1) },
      { status: "canceled" as const, cancelAtPeriodEnd: true, currentPeriodEnd: at(3) },
    ]) {
      expect(isEntitled(sub(fields), now)).toBe(true);
      expect(blocks(fields)).toBe(true);
    }
  });
  it("blocks three Free states that can still charge, each explained on the page", () => {
    // Past due after the grace: Paddle can still recover the payment.
    expect(blocks({ status: "past_due", pastDueSince: at(-40) })).toBe(true);
    expect(blocks({ status: "paused" })).toBe(true);
    // Revoked, with the provider cancel still owed.
    expect(blocks({ revokedAt: at(-1) })).toBe(true);
    expect(blocks({ status: "trialing", revokedAt: at(-1) })).toBe(true);
  });
  it("opens once it can't charge or grant any more", () => {
    // Canceled at once: nothing more is charged, so it never blocks.
    expect(blocks({ status: "canceled", currentPeriodEnd: at(3) })).toBe(false);
    expect(blocks({ status: "canceled", currentPeriodEnd: at(-1) })).toBe(false);
    expect(blocks({ status: "canceled", currentPeriodEnd: null })).toBe(false);
    expect(
      blocks({
        status: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: at(3),
        revokedAt: at(-1),
      }),
    ).toBe(false);
    // A scheduled cancel whose period ended, with the final event late.
    expect(blocks({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) })).toBe(false);
  });
});

describe("adjustmentRevokesPro", () => {
  const adj = (fields: Partial<Parameters<typeof adjustmentRevokesPro>[0]>) => ({
    adjustmentId: "adj_1",
    action: "refund",
    type: "full",
    status: "approved",
    subscriptionId: "sub_1",
    transactionId: "txn_1",
    ...fields,
  });
  const revokes = (fields: Partial<Parameters<typeof adjustmentRevokesPro>[0]>) =>
    adjustmentRevokesPro(adj(fields), "txn_1");
  it("ends Pro on an approved chargeback, or a full refund of the current period's payment", () => {
    expect(revokes({})).toBe(true);
    expect(revokes({ action: "chargeback", type: null })).toBe(true);
    expect(revokes({ action: "chargeback", transactionId: "txn_old" })).toBe(true);
  });
  it("keeps Pro on a full refund of any other transaction: an earlier period or a duplicate", () => {
    expect(revokes({ transactionId: "txn_old" })).toBe(false);
    expect(revokes({ transactionId: null })).toBe(false);
    expect(adjustmentRevokesPro(adj({}), null)).toBe(false);
  });
  it("leaves partial refunds, credits, warnings, pending ones and one-off transactions alone", () => {
    expect(revokes({ type: "partial" })).toBe(false);
    expect(revokes({ action: "credit" })).toBe(false);
    expect(revokes({ action: "chargeback_warning" })).toBe(false);
    expect(revokes({ status: "pending_approval" })).toBe(false);
    expect(revokes({ subscriptionId: null })).toBe(false);
  });
});

describe("paysNewerPeriod", () => {
  const txn = (origin: string | null, start: Date | null, end: Date | null = null) => ({
    origin,
    billingPeriodStart: start,
    billingPeriodEnd: end,
  });
  const period = { start: at(0), end: at(30) };
  const paysNewerPeriod = (
    t: ReturnType<typeof txn>,
    recordedStart: Date | null,
    stored: { start: Date | null; end: Date | null } = period,
  ) => paysNewer(t, recordedStart, stored);
  it("takes a renewal or the first payment for a later period", () => {
    expect(paysNewerPeriod(txn("subscription_recurring", at(30)), at(0))).toBe(true);
    expect(paysNewerPeriod(txn("web", at(0)), null)).toBe(true);
    expect(paysNewerPeriod(txn("api", at(0)), null)).toBe(true);
  });
  it("takes a plan or interval change only when it starts a newer period", () => {
    expect(paysNewerPeriod(txn("subscription_update", at(10)), at(0))).toBe(true);
    expect(paysNewerPeriod(txn("subscription_update", at(0)), at(0))).toBe(false);
    expect(paysNewerPeriod(txn("subscription_update", at(10)), null)).toBe(false);
  });
  it("tells a proration from an interval change by where its period ends", () => {
    // A mid-period change: from the change to the stored period's end.
    expect(paysNewerPeriod(txn("subscription_update", at(10), at(30)), at(0))).toBe(false);
    // An interval change, before and after its subscription.updated is stored.
    expect(paysNewerPeriod(txn("subscription_update", at(10), at(375)), at(0))).toBe(true);
    expect(
      paysNewerPeriod(txn("subscription_update", at(10), at(375)), at(0), {
        start: at(10),
        end: at(375),
      }),
    ).toBe(true);
  });
  it("keeps the first payment for a period: a duplicate or an older period doesn't replace it", () => {
    expect(paysNewerPeriod(txn("subscription_recurring", at(0)), at(0))).toBe(false);
    expect(paysNewerPeriod(txn("subscription_recurring", at(-30)), at(0))).toBe(false);
  });
  it("ignores one-off charges, card checks and transactions without a period", () => {
    expect(paysNewerPeriod(txn("subscription_charge", at(30)), at(0))).toBe(false);
    expect(paysNewerPeriod(txn("subscription_payment_method_change", at(30)), at(0))).toBe(false);
    expect(paysNewerPeriod(txn("subscription_recurring", null), at(0))).toBe(false);
    expect(paysNewerPeriod(txn(null, at(30)), at(0))).toBe(false);
  });
});

describe("planForPrice", () => {
  it("maps the configured Pro prices to Pro and anything else to no plan", () => {
    const prices = new Set(["pri_month", "pri_year"]);
    expect(planForPrice("pri_year", prices)).toBe("pro");
    expect(planForPrice("pri_other", prices)).toBeNull();
    expect(planForPrice(null, prices)).toBeNull();
  });
});

describe("subscription statuses", () => {
  it("match the database check constraint", () => {
    expect([...SUBSCRIPTION_STATUSES].sort()).toEqual([...BILLING_STATUSES].sort());
  });
});

describe("workspaceLimitMessage", () => {
  it("says why creation is refused, per plan", () => {
    expect(workspaceLimitMessage("free", 1)).toContain("Free accounts can own 1 workspace.");
    expect(workspaceLimitMessage("free", 1)).toContain("A new workspace starts on Free.");
    expect(workspaceLimitMessage("pro", 2)).toContain("You own 2 workspaces, the most on Pro");
  });

  it("never asks for an upgrade: the message is shown without a control", () => {
    const messages = [
      workspaceLimitMessage("free", 1),
      memberLimitMessage("free", 3, 10, "invite"),
      memberLimitMessage("free", 3, 10, "accept"),
    ];
    for (const message of messages) expect(message).not.toMatch(/upgrade/i);
    expect(messages[1]).toContain("Pro workspaces up to 10");
  });
});
