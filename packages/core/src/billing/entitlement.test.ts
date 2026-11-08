import { BILLING_STATUSES } from "@receipt-ocr/db";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUSES } from "./provider";
import {
  isEntitled,
  PAST_DUE_GRACE_DAYS,
  workspaceLimitMessage,
  type EntitlementFields,
} from "./entitlement";

const now = new Date("2026-11-08T12:00:00Z");
const day = 86_400_000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);
const sub = (fields: Partial<EntitlementFields>): EntitlementFields => ({
  status: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: at(20),
  pastDueSince: null,
  ...fields,
});

describe("isEntitled (subscription state to plan)", () => {
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
    expect(isEntitled(sub({ status: "past_due", pastDueSince: at(-1) }), now)).toBe(true);
    expect(
      isEntitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS + 0.01) }), now),
    ).toBe(true);
    expect(
      isEntitled(sub({ status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_DAYS) }), now),
    ).toBe(false);
    expect(isEntitled(sub({ status: "past_due", pastDueSince: null }), now)).toBe(false);
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
    expect(workspaceLimitMessage("pro", 2)).toContain("You already own 2 workspaces");
  });
});
