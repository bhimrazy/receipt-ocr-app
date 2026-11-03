import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, PLANS, planPolicy, workspaceLimitForPlan } from "./plans";

describe("planPolicy", () => {
  it("returns the named plan", () => {
    expect(planPolicy("pro")).toBe(PLANS.pro);
  });

  it("falls back to the default plan for unknown or missing values", () => {
    expect(planPolicy(undefined)).toBe(PLANS[DEFAULT_PLAN]);
    expect(planPolicy("enterprise-that-does-not-exist")).toBe(PLANS[DEFAULT_PLAN]);
    expect(planPolicy("")).toBe(PLANS[DEFAULT_PLAN]);
  });
});

describe("workspaceLimitForPlan", () => {
  it("matches the policy table", () => {
    expect(workspaceLimitForPlan("free")).toBe(PLANS.free.workspaces);
    expect(workspaceLimitForPlan("pro")).toBe(PLANS.pro.workspaces);
  });

  it("never returns an unbounded or zero limit", () => {
    for (const plan of [...Object.keys(PLANS), "unknown", undefined]) {
      const limit = workspaceLimitForPlan(plan);
      expect(limit).toBeGreaterThan(0);
      expect(Number.isFinite(limit)).toBe(true);
    }
  });
});

describe("plan policies", () => {
  it("keeps the burst ceiling below the daily allowance", () => {
    // A per-minute limit above the daily one would make the daily limit
    // unreachable and the burst check meaningless.
    for (const [name, policy] of Object.entries(PLANS)) {
      expect(policy.receiptsPerMinute, name).toBeLessThanOrEqual(policy.receiptsPerDay);
    }
  });
});
