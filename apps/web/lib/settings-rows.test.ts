import { describe, expect, it } from "vitest";
import { settingsRows } from "./settings-rows";

describe("settingsRows", () => {
  it("lists Plan and billing, Workspace, Groups, Appearance and Security with their current values", () => {
    const rows = settingsRows({
      planSummary: "Free · 85 / 100 scans",
      workspaceName: "Sam's",
      protectedAccount: false,
    });
    expect(rows.map((r) => (r === "appearance" ? r : [r.label, r.value, r.href]))).toEqual([
      ["Plan and billing", "Free · 85 / 100 scans", "/app/settings/billing"],
      ["Workspace", "Sam's", "/app/settings/members"],
      ["Groups", "", "/app/receipts/groups"],
      "appearance",
      ["Security", "Set up", "/app/settings/security"],
    ]);
  });

  it("says Protected once a second check is set up", () => {
    const rows = settingsRows({
      planSummary: "Pro · 1 / 500 scans",
      workspaceName: "W",
      protectedAccount: true,
    });
    expect(rows.at(-1)).toMatchObject({ label: "Security", value: "Protected" });
  });
});
