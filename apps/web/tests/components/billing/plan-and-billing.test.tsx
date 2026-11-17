import type { WorkspaceBilling } from "@receipt-ocr/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MB } from "@receipt-ocr/core/plans";
import type { Usage } from "@/components/usage-meter";
import { DEFAULT_PLANS } from "@/lib/plans";
import { PlanAndBilling, type PlanAndBillingProps } from "@/components/billing/plan-and-billing";

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

const usage = (usedBytes = 12.6 * MB): Usage => ({
  period: "month",
  scope: "user",
  used: 3,
  limit: 30,
  resetsAt: new Date("2026-12-01T00:00:00Z"),
  blocked: null,
  opensAt: new Date("2026-12-01T00:00:00Z"),
  storage: { usedBytes, limitBytes: 100 * MB },
});

const render = (
  fields: Partial<WorkspaceBilling> | null,
  over: Partial<PlanAndBillingProps> = {},
) => {
  const props: PlanAndBillingProps = {
    plan: "free",
    policy: DEFAULT_PLANS.free,
    plans: DEFAULT_PLANS,
    usage: usage(),
    owner: true,
    manages: true,
    impersonating: false,
    ownsPro: false,
    subscription: fields ? subscription(fields) : null,
    isBuyer: true,
    checkout: { settings: { environment: "sandbox", clientToken: "test_x" }, testMode: false },
    portalAvailable: true,
    workspaceId: "org_1",
    interval: "month",
    ...over,
  };
  return renderToStaticMarkup(<PlanAndBilling {...props} />);
};

describe("PlanAndBilling storage", () => {
  it("always shows storage, in the limits line and on both plan cards", () => {
    const html = render(null);
    expect(html).toContain("12 MB of 100 MB used.");
    expect(html).toContain("50 a month · 20 a day · 2 members · 100 MB storage");
    expect(html).toContain("100 MB of receipt storage");
    expect(html).toContain("5 GB of receipt storage");
  });

  it("says how to make room from 80%, and sends a member to the owner", () => {
    expect(render(null, { usage: usage(86 * MB) })).toContain(
      "86 MB of 100 MB used. Delete receipts to make room.",
    );
    expect(render(null, { usage: usage(100 * MB), manages: false })).toContain(
      "This workspace&#x27;s 100 MB of storage is full. Ask the owner to make room.",
    );
  });

  it("never reads as full before it is", () => {
    expect(render(null, { usage: usage(99.99 * MB) })).toContain("99 MB of 100 MB used.");
  });
});

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

  it("tells an owner who isn't the buyer who can act, without pointing at controls they lack", () => {
    const html = render({ status: "paused", checkoutBlocked: true }, { isBuyer: false });
    expect(html).not.toContain("Upgrade to Pro");
    expect(html).not.toContain("Cancel subscription");
    expect(html).not.toContain("Cancel it below");
    expect(html).not.toContain("under Subscription above");
    expect(html).toContain("Ask owner@example.com, who subscribed, to cancel it");
  });

  it("sends the buyer to Paddle's emails while billing is unavailable", () => {
    const html = render({ status: "paused", checkoutBlocked: true }, { portalAvailable: false });
    expect(html).not.toContain("Cancel it below");
    expect(html).toContain("Reply to any email from Paddle about it");
  });

  it("explains a revoked subscription whose cancel is still owed", () => {
    const html = render({ status: "active", revoked: true, checkoutBlocked: true });
    expect(html).not.toContain("Upgrade to Pro");
    expect(html).not.toContain("Cancel subscription");
    expect(html).toContain("is being canceled in Paddle");
  });
});
