import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, DEFAULT_PLANS, planLabel, policyFor, type PlanTable } from "./plans";

describe("policyFor", () => {
  it("returns the named plan from the table it is given", () => {
    const saved: PlanTable = {
      free: { workspaces: 2, receiptsPerDay: 5, receiptsPerMinute: 2 },
      pro: DEFAULT_PLANS.pro,
    };
    expect(policyFor(saved, "free")).toBe(saved.free);
    expect(policyFor(DEFAULT_PLANS, "pro")).toBe(DEFAULT_PLANS.pro);
  });

  it("falls back to the default plan for unknown or missing values, never unlimited", () => {
    for (const plan of [undefined, null, "", "enterprise-that-does-not-exist"]) {
      expect(policyFor(DEFAULT_PLANS, plan)).toBe(DEFAULT_PLANS[DEFAULT_PLAN]);
    }
  });
});

describe("default plans", () => {
  it("gives the free plan 20 receipts a day and 1 workspace", () => {
    expect(DEFAULT_PLANS.free).toMatchObject({ receiptsPerDay: 20, workspaces: 1 });
  });

  it("keeps the burst ceiling below the daily allowance", () => {
    // A per-minute limit above the daily one would make the daily limit
    // unreachable and the burst check meaningless.
    for (const [name, policy] of Object.entries(DEFAULT_PLANS)) {
      expect(policy.receiptsPerMinute, name).toBeLessThanOrEqual(policy.receiptsPerDay);
    }
  });
});

describe("planLabel", () => {
  it("names the plan for the usage meter", () => {
    expect(planLabel("free")).toBe("Free plan");
  });
});
