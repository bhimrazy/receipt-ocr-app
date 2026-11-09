import { describe, expect, it } from "vitest";
import type { Usage } from "@/components/usage-meter";
import { DEFAULT_PLANS, type PlanTable } from "./plans";
import {
  bannerCopy,
  comparisonRows,
  homeCardCopy,
  limitUpgradeLine,
  usedLine,
} from "./upgrade-copy";

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

// What an admin might save in Plan limits: every number differs from the defaults.
const edited: PlanTable = {
  free: { ...DEFAULT_PLANS.free, receiptsPerDay: 15, receiptsPerMonth: 60, membersPerWorkspace: 2 },
  pro: {
    ...DEFAULT_PLANS.pro,
    receiptsPerDay: 150,
    receiptsPerMonth: 750,
    membersPerWorkspace: 12,
    workspaces: 3,
  },
};

describe("upgrade copy", () => {
  it("words the comparison from the saved limits, per person against shared", () => {
    expect(comparisonRows(edited)).toEqual([
      { label: "Scans a month", free: "60 per person", pro: "750 shared" },
      { label: "Scans a day", free: "15", pro: "150" },
      { label: "Members per workspace", free: "2", pro: "12" },
      { label: "Workspaces you can own", free: "1", pro: "3" },
      { label: "Busy-day pauses", free: "Can pause on busy days", pro: "Never" },
    ]);
  });

  it("says when a plan has no monthly limit or no pool", () => {
    const rows = comparisonRows({
      free: { ...edited.free, receiptsPerMonth: null, poolPerDay: null },
      pro: edited.pro,
    });
    expect(rows[0]).toEqual({ label: "Scans a month", free: "No limit", pro: "750 shared" });
    expect(rows[4]).toEqual({ label: "Busy-day pauses", free: "Never", pro: "Never" });
  });

  it("keeps the quiet card calm and the near card specific, shared by its members", () => {
    const quiet = homeCardCopy("quiet", usage(30), edited.pro);
    expect(quiet).toEqual({
      badge: "Free plan",
      title: "Pro for this workspace",
      body: "30 of 100 Free scans used this month. Pro gives this workspace 750 scans a month, up to 150 a day, shared by its members.",
      action: "See Pro, $9 a month",
    });
    const near = homeCardCopy("near", usage(84), edited.pro);
    expect(near.badge).toBe("84 of 100 used");
    expect(near.title).toBe("You've used 84 of 100 Free scans this month");
    expect(near.body).toBe(
      "They reset on 1 December at 00:00 UTC. Pro gives this workspace 750 scans a month, up to 150 a day, shared by its members, for $9 a month.",
    );
    expect(near.action).toBe("Upgrade to Pro");
  });

  it("names the window and when uploads open in the banner", () => {
    expect(bannerCopy(usage(100, { blocked: "month" }), edited.pro)).toEqual({
      body: "You've used all 100 Free scans this month. Uploads open on 1 December. Pro gives this workspace 750 scans a month, up to 150 a day.",
      opens: "1 December",
    });
    const day = bannerCopy(
      usage(40, {
        blocked: "day",
        day: { used: 20, limit: 20 },
        opensAt: new Date("2026-11-10T00:00:00Z"),
      }),
      edited.pro,
    );
    expect(day?.body).toBe(
      "You've used today's 20 Free scans. Uploads open at 00:00 UTC. Pro allows up to 150 a day in this workspace.",
    );
    expect(bannerCopy(usage(5, { blocked: "pool" }), edited.pro)?.body).toContain(
      "Pro workspaces don't use it.",
    );
    expect(bannerCopy(usage(5, { blocked: "global" }), edited.pro)).toBeNull();
  });

  it("adds the owner's line to the upload panel's limit state", () => {
    expect(limitUpgradeLine(usage(100, { blocked: "month" }), edited.pro)).toBe(
      "Or upgrade this workspace to Pro for 750 scans a month, up to 150 a day.",
    );
    expect(limitUpgradeLine(usage(40, { blocked: "day" }), edited.pro)).toBe(
      "Pro allows up to 150 a day in this workspace.",
    );
    expect(limitUpgradeLine(usage(5, { blocked: "pool" }), edited.pro)).toBeNull();
  });

  it("says today for a plan counted by the day", () => {
    expect(usedLine(usage(84))).toBe("84 / 100 used this month");
    expect(usedLine(usage(12, { period: "day", limit: 20 }))).toBe("12 / 20 used today");
  });
});
