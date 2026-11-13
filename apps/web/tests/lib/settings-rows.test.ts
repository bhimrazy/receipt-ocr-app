import { describe, expect, it } from "vitest";
import { settingsRows } from "@/lib/settings-rows";

describe("settingsRows", () => {
  it("lists Plan and billing, Workspace, Groups, Appearance, Security and Help with their current values", () => {
    const rows = settingsRows({
      planSummary: "Free · 85 / 100 scans",
      workspaceName: "Sam's",
      protectedAccount: false,
    });
    expect(
      rows.map((r) => (typeof r === "string" ? r : [r.label, r.detail ?? r.value, r.href])),
    ).toEqual([
      ["Plan and billing", "Free · 85 / 100 scans", "/app/settings/billing"],
      ["Workspace", "Sam's", "/app/settings/members"],
      ["Groups", "", "/app/receipts/groups"],
      "appearance",
      ["Security", "Set up", "/app/settings/security"],
      "help",
    ]);
  });

  it("says Protected once a second check is set up", () => {
    const rows = settingsRows({
      planSummary: "Pro · 1 / 500 scans",
      workspaceName: "W",
      protectedAccount: true,
    });
    expect(rows.at(-2)).toMatchObject({ label: "Security", value: "Protected" });
  });
});
