import { DEFAULT_PLANS, type PlanPolicy } from "@receipt-ocr/core/plans";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_PLAN,
  freeFeatures,
  proFeatures,
  scansLine,
  welcomePlanLine,
  workspaceCapNote,
} from "@/lib/plan-copy";

describe("account copy", () => {
  it("words the welcome email's plan line", () => {
    expect(welcomePlanLine("free", DEFAULT_PLANS.free)).toBe(
      "Your Free plan includes 50 scans a month per workspace, up to 20 a day. Limits reset at 00:00 UTC.",
    );
    expect(welcomePlanLine("free", { ...DEFAULT_PLANS.free, scope: "user" })).toBe(
      "Your Free plan includes 20 scans a day, up to 50 a month. Limits reset at 00:00 UTC.",
    );
  });

  it("states the workspace cap as a fact, never an instruction to upgrade", () => {
    expect(workspaceCapNote("free", 1, 2)).toBe(
      "Free accounts own 1 workspace. Pro owners can have 2.",
    );
    expect(workspaceCapNote("free", 2, 2)).toBe("Free accounts own 2 workspaces.");
    expect(workspaceCapNote("pro", 2, 2)).toBe("You own 2 workspaces, the most on Pro.");
  });
});

describe("plan card copy", () => {
  it("words Free from its limits", () => {
    expect(freeFeatures(DEFAULT_PLANS.free).slice(0, 3)).toEqual([
      "50 scans a month per workspace, up to 20 a day",
      "Up to 2 members",
      "1 workspace to own",
    ]);
  });

  it("words Pro from its limits, with one workspace line that agrees with the table", () => {
    const pro = proFeatures(DEFAULT_PLANS.pro);
    expect(pro).toEqual([
      "500 scans a month per workspace, up to 200 a day",
      "Up to 5 members",
      "Own up to 2 workspaces, each upgraded separately",
      "Never paused on busy days",
      "Everything in Free",
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
    expect(proFeatures({ ...saved, poolPerDay: 1000 })).toEqual([
      "800 scans a month per workspace, up to 300 a day",
      "Up to 1 member",
      "Own up to 4 workspaces, each upgraded separately",
      "Everything in Free",
    ]);
  });

  it("drops the month when a plan has no monthly limit", () => {
    expect(scansLine({ ...DEFAULT_PLANS.free, scope: "user", receiptsPerMonth: null })).toBe(
      "20 scans a day for each member",
    );
    expect(scansLine({ ...DEFAULT_PLANS.pro, receiptsPerMonth: null })).toBe(
      "200 scans a day per workspace",
    );
  });

  it("offers Custom without a price or features we don't have", () => {
    expect(CUSTOM_PLAN.price).toBe("Let's talk");
    expect(CUSTOM_PLAN.features.join(" ")).not.toMatch(/team|roadmap/i);
    const copy = [CUSTOM_PLAN.description, ...CUSTOM_PLAN.features].join(" ");
    expect(copy).not.toMatch(/\$|\d|SLA|SSO|\bAPI\b|unlimited|guarantee/i);
  });
});
