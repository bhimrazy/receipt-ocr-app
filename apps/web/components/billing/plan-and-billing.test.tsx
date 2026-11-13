import type { WorkspaceBilling } from "@receipt-ocr/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLANS } from "@/lib/plans";
import { PlanAndBilling, type PlanAndBillingProps } from "./plan-and-billing";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const subscription = (fields: Partial<WorkspaceBilling>): WorkspaceBilling => ({
  status: "active",
  interval: "month",
  currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  entitled: false,
  endedAt: new Date("2026-11-01T00:00:00Z"),
  revoked: false,
  buyer: { id: "u1", email: "owner@example.com" },
  checkoutBlocked: false,
  ...fields,
});

const render = (fields: Partial<WorkspaceBilling> | null) => {
  const props: PlanAndBillingProps = {
    plan: "free",
    policy: DEFAULT_PLANS.free,
    plans: DEFAULT_PLANS,
    usage: {
      period: "month",
      scope: "user",
      used: 3,
      limit: 30,
      resetsAt: new Date("2026-12-01T00:00:00Z"),
      blocked: null,
      opensAt: new Date("2026-12-01T00:00:00Z"),
    },
    owner: true,
    impersonating: false,
    ownsPro: false,
    subscription: fields ? subscription(fields) : null,
    isBuyer: true,
    checkout: { settings: { environment: "sandbox", clientToken: "test_x" }, testMode: false },
    portalAvailable: true,
    workspaceId: "org_1",
    interval: "month",
  };
  return renderToStaticMarkup(<PlanAndBilling {...props} />);
};

describe("PlanAndBilling on Free", () => {
  it("offers the checkout when no subscription can charge", () => {
    expect(render(null)).toContain("Upgrade to Pro");
    expect(render({ status: "canceled" })).toContain("Upgrade to Pro");
  });

  it("offers no checkout beside a subscription that can still charge, and points to it", () => {
    for (const status of ["paused", "past_due"] as const) {
      const html = render({ status, checkoutBlocked: true });
      expect(html).not.toContain("Upgrade to Pro");
      expect(html).toContain("This workspace still has a subscription in Paddle.");
      expect(html).toContain("Cancel subscription");
    }
  });
});
