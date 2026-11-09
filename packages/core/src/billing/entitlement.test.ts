import { BILLING_STATUSES } from "@receipt-ocr/db";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUSES } from "./provider";
import { parseProPriceIds } from "./config";
import {
  adjustmentRevokesPro,
  canStillCharge,
  isEntitled,
  PAST_DUE_GRACE_DAYS,
  workspaceLimitMessage,
  type EntitlementFields,
} from "./entitlement";

const now = new Date("2026-11-08T12:00:00Z");
const day = 86_400_000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);
const PRO = new Set(["pri_month", "pri_year"]);
const sub = (fields: Partial<EntitlementFields>): EntitlementFields => ({
  status: "active",
  priceId: "pri_month",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: at(20),
  pastDueSince: null,
  revokedAt: null,
  ...fields,
});
const entitled = (s: EntitlementFields, when: Date) => isEntitled(s, when, PRO);

describe("isEntitled (subscription state to plan)", () => {
  it("grants Pro only for a configured Pro price, and never once revoked", () => {
    expect(entitled(sub({ priceId: "pri_year" }), now)).toBe(true);
    expect(entitled(sub({ priceId: "pri_cheap" }), now)).toBe(false);
    expect(entitled(sub({ priceId: null }), now)).toBe(false);
    expect(isEntitled(sub({}), now, new Set())).toBe(false);
    expect(entitled(sub({ revokedAt: at(-1) }), now)).toBe(false);
  });

  it("grants Pro while active or trialing", () => {
    expect(entitled(sub({}), now)).toBe(true);
    expect(entitled(sub({ status: "trialing" }), now)).toBe(true);
    // A renewal webhook that is late doesn't drop a paying workspace to Free.
    expect(entitled(sub({ currentPeriodEnd: at(-2) }), now)).toBe(true);
  });

  it("keeps Pro until the period end after a cancel at period end", () => {
    expect(entitled(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(3) }), now)).toBe(true);
    // The period is over and the final `canceled` event is late: Free.
    expect(entitled(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-0.01) }), now)).toBe(
      false,
    );
    expect(
      entitled(sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(3) }), now),
    ).toBe(true);
  });

  it("ends Pro at once on an immediate cancel, and while paused", () => {
    expect(entitled(sub({ status: "canceled", currentPeriodEnd: at(10) }), now)).toBe(false);
    expect(
      entitled(sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) }), now),
    ).toBe(false);
    expect(entitled(sub({ status: "paused" }), now)).toBe(false);
  });

  it(`gives a past_due subscription ${PAST_DUE_GRACE_DAYS} days of grace`, () => {
    // Paddle Retain's default dunning window; Pro must outlast its retries.
    expect(PAST_DUE_GRACE_DAYS).toBe(30);
    expect(entitled(sub({ status: "past_due", pastDueSince: at(-1) }), now)).toBe(true);
    expect(entitled(sub({ status: "past_due", pastDueSince: at(-29) }), now)).toBe(true);
    expect(
      entitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS + 0.01) }), now),
    ).toBe(true);
    expect(entitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS) }), now)).toBe(
      false,
    );
    expect(entitled(sub({ status: "past_due", pastDueSince: null }), now)).toBe(false);
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
  it("ends Pro on an approved chargeback or full refund of a subscription", () => {
    expect(adjustmentRevokesPro(adj({}))).toBe(true);
    expect(adjustmentRevokesPro(adj({ action: "chargeback", type: null }))).toBe(true);
  });
  it("leaves partial refunds, credits, warnings, pending ones and one-off transactions alone", () => {
    expect(adjustmentRevokesPro(adj({ type: "partial" }))).toBe(false);
    expect(adjustmentRevokesPro(adj({ action: "credit" }))).toBe(false);
    expect(adjustmentRevokesPro(adj({ action: "chargeback_warning" }))).toBe(false);
    expect(adjustmentRevokesPro(adj({ status: "pending_approval" }))).toBe(false);
    expect(adjustmentRevokesPro(adj({ subscriptionId: null }))).toBe(false);
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
});
