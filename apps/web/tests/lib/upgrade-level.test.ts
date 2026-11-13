import { describe, expect, it } from "vitest";
import type { Usage } from "@/components/usage-meter";
import { DEFAULT_PLANS } from "@/lib/plans";
import {
  decideUpgradeOffer,
  NEAR_RATIO,
  upgradeLevel,
  usageRatio,
  type OfferInput,
} from "@/lib/upgrade-level";

const usage = (used: number, over: Partial<Usage> = {}): Usage => ({
  period: "month",
  scope: "user",
  used,
  limit: 100,
  resetsAt: new Date("2026-12-01T00:00:00Z"),
  day: { used: 0, limit: 20 },
  blocked: null,
  opensAt: new Date("2026-12-01T00:00:00Z"),
  ...over,
});

describe("upgradeLevel", () => {
  it("is quiet under 80% of the month and near from 80%", () => {
    expect(NEAR_RATIO).toBe(0.8);
    expect(upgradeLevel(usage(0))).toBe("quiet");
    expect(upgradeLevel(usage(79))).toBe("quiet");
    expect(upgradeLevel(usage(80))).toBe("near");
    expect(upgradeLevel(usage(100))).toBe("near");
  });

  it("uses the day when the plan has no monthly limit", () => {
    const day = (used: number) => usage(used, { period: "day", limit: 20, day: undefined });
    expect(upgradeLevel(day(15))).toBe("quiet");
    expect(upgradeLevel(day(16))).toBe("near");
  });

  it("is at for the month, the day and the Free pool, and null for the service-wide cap", () => {
    expect(upgradeLevel(usage(100, { blocked: "month" }))).toBe("at");
    expect(upgradeLevel(usage(30, { blocked: "day" }))).toBe("at");
    expect(upgradeLevel(usage(5, { blocked: "pool" }))).toBe("at");
    expect(upgradeLevel(usage(5, { blocked: "global" }))).toBeNull();
  });

  it("treats a zero limit as nothing used", () => {
    expect(usageRatio({ used: 5, limit: 0 })).toBe(0);
  });
});

const checkout = {
  settings: { environment: "production" as const, clientToken: "live_x" },
  testMode: false,
};

const input = (over: Partial<OfferInput> = {}): OfferInput => ({
  plan: "free",
  impersonating: false,
  owner: true,
  usage: usage(40),
  checkout,
  openToEveryone: true,
  checkoutBlocked: false,
  plans: DEFAULT_PLANS,
  workspaceId: "org_1",
  workspaceName: "Acme Books",
  dismissals: {},
  now: Date.parse("2026-11-09T12:00:00Z"),
  ...over,
});

describe("decideUpgradeOffer", () => {
  it("offers an owner of a Free workspace Pro, with the plan limits and checkout", () => {
    expect(decideUpgradeOffer(input())).toEqual({
      level: "quiet",
      audience: "owner",
      usage: usage(40),
      free: DEFAULT_PLANS.free,
      pro: DEFAULT_PLANS.pro,
      workspaceId: "org_1",
      workspaceName: "Acme Books",
      dismissed: { home: false, banner: false },
      checkout,
    });
  });

  it("offers nothing on Pro, including an admin's comp, which also reads as Pro", () => {
    expect(decideUpgradeOffer(input({ plan: "pro" }))).toBeNull();
  });

  it("offers nothing to anyone while a subscription can still charge, even on Free", () => {
    const blocked = { checkoutBlocked: true, usage: usage(100, { blocked: "month" }) };
    expect(decideUpgradeOffer(input(blocked))).toBeNull();
    expect(decideUpgradeOffer(input({ ...blocked, owner: false }))).toBeNull();
  });

  it("offers nothing while an admin is signed in as the user", () => {
    expect(decideUpgradeOffer(input({ impersonating: true }))).toBeNull();
  });

  it("offers nothing while billing is off", () => {
    const off = { checkout: null, openToEveryone: false };
    expect(decideUpgradeOffer(input(off))).toBeNull();
    expect(decideUpgradeOffer(input({ ...off, owner: false }))).toBeNull();
  });

  it("offers nothing on sandbox keys on the live site to anyone but a platform admin", () => {
    const soon = { checkout: null, openToEveryone: false };
    expect(decideUpgradeOffer(input({ ...soon, usage: usage(90) }))).toBeNull();
    expect(
      decideUpgradeOffer(input({ ...soon, owner: false, usage: usage(100, { blocked: "month" }) })),
    ).toBeNull();
    const admin = decideUpgradeOffer(
      input({ openToEveryone: false, checkout: { ...checkout, testMode: true } }),
    );
    expect(admin?.audience).toBe("owner");
    expect(admin?.checkout?.testMode).toBe(true);
  });

  it("gives a member (workspace admins included) the offer without a checkout", () => {
    const member = decideUpgradeOffer(input({ owner: false, checkout: null }));
    expect(member?.audience).toBe("member");
    expect(member?.checkout).toBeNull();
  });

  it("offers nothing while every plan is paused, or without usage", () => {
    expect(decideUpgradeOffer(input({ usage: usage(10, { blocked: "global" }) }))).toBeNull();
    expect(decideUpgradeOffer(input({ usage: null }))).toBeNull();
  });

  it("carries what the person dismissed", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const offer = decideUpgradeOffer(
      input({
        usage: usage(100, { blocked: "month" }),
        dismissals: { banner: { until: now + 1000 } },
        now,
      }),
    );
    expect(offer?.level).toBe("at");
    expect(offer?.dismissed).toEqual({ home: false, banner: true });
  });
});
