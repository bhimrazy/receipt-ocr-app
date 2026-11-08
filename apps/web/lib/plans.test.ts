import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, DEFAULT_PLANS, planLabel, policyFor, type PlanTable } from "./plans";

describe("policyFor", () => {
  it("returns the named plan from the table it is given", () => {
    const saved: PlanTable = {
      free: {
        workspaces: 2,
        receiptsPerDay: 5,
        scope: "user",
        receiptsPerMonth: null,
        poolPerDay: null,
        receiptsPerMinute: 2,
        batchMax: 3,
        membersPerWorkspace: 3,
      },
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

  it("gives Pro 500 a month per workspace, up to 200 a day, and 2 owned workspaces", () => {
    expect(DEFAULT_PLANS.pro).toMatchObject({
      scope: "workspace",
      receiptsPerMonth: 500,
      receiptsPerDay: 200,
      workspaces: 2,
      poolPerDay: null,
    });
  });

  it("counts Free per person: 20 a day, 100 a month, with a 300 a day pool across every Free user", () => {
    expect(DEFAULT_PLANS.free).toMatchObject({
      scope: "user",
      receiptsPerDay: 20,
      receiptsPerMonth: 100,
      poolPerDay: 300,
    });
  });

  it("keeps Free's month below Pro's, so Free can't out-scan a paid workspace", () => {
    expect(DEFAULT_PLANS.free.receiptsPerMonth!).toBeLessThan(DEFAULT_PLANS.pro.receiptsPerMonth!);
  });

  it("allows 3 members in a Free workspace and 10 in a Pro one", () => {
    expect(DEFAULT_PLANS.free.membersPerWorkspace).toBe(3);
    expect(DEFAULT_PLANS.pro.membersPerWorkspace).toBe(10);
  });

  it("caps an upload batch at 10 images on every plan", () => {
    for (const policy of Object.values(DEFAULT_PLANS)) expect(policy.batchMax).toBe(10);
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
