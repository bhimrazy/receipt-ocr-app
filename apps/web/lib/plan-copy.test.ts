import { DEFAULT_PLANS, type PlanPolicy } from "@receipt-ocr/core/plans";
import { describe, expect, it } from "vitest";
import { CUSTOM_PLAN, freeFeatures, proFeatures, scansLine } from "./plan-copy";

describe("plan card copy", () => {
  it("words Free from its limits", () => {
    expect(freeFeatures(DEFAULT_PLANS.free).slice(0, 3)).toEqual([
      "20 scans a day and 100 a month for each member",
      "Up to 3 members",
      "1 workspace to own",
    ]);
  });

  it("words Pro from its limits, with one workspace line that agrees with the table", () => {
    const pro = proFeatures(DEFAULT_PLANS.pro);
    expect(pro).toEqual([
      "Everything in Free",
      "500 scans a month shared by the workspace, up to 200 a day",
      "Up to 10 members",
      "Own up to 2 workspaces (each upgraded separately)",
      "Cancel any time",
    ]);
    expect(pro.filter((line) => /workspaces?\b/.test(line) && /\d/.test(line))).toHaveLength(2);
  });

  it("follows a saved table, not the defaults", () => {
    const saved: PlanPolicy = {
      ...DEFAULT_PLANS.pro,
      receiptsPerMonth: 800,
      receiptsPerDay: 300,
      membersPerWorkspace: 1,
      workspaces: 4,
    };
    expect(proFeatures(saved)).toEqual([
      "Everything in Free",
      "800 scans a month shared by the workspace, up to 300 a day",
      "Up to 1 member",
      "Own up to 4 workspaces (each upgraded separately)",
      "Cancel any time",
    ]);
  });

  it("drops the month when a plan has no monthly limit", () => {
    expect(scansLine({ ...DEFAULT_PLANS.free, receiptsPerMonth: null })).toBe(
      "20 scans a day for each member",
    );
    expect(scansLine({ ...DEFAULT_PLANS.pro, receiptsPerMonth: null })).toBe(
      "200 scans a day shared by the workspace",
    );
  });

  it("offers Custom without a price or features we don't have", () => {
    expect(CUSTOM_PLAN.price).toBe("Let's talk");
    expect(CUSTOM_PLAN.features).toContain("More members and workspaces");
    const copy = [CUSTOM_PLAN.description, ...CUSTOM_PLAN.features].join(" ");
    expect(copy).not.toMatch(/\$|\d|SLA|SSO|\bAPI\b|unlimited|guarantee/i);
  });
});
