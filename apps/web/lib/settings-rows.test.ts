import { describe, expect, it } from "vitest";
import { settingsRows } from "./settings-rows";

describe("settingsRows", () => {
  it("lists Plan, Workspace, Groups, Appearance and Security with their current values", () => {
    const rows = settingsRows({
      planLabel: "Free",
      workspaceName: "Sam's",
      protectedAccount: false,
    });
    expect(rows.map((r) => (r === "appearance" ? r : [r.label, r.value, r.href]))).toEqual([
      ["Plan", "Free", "/app/settings/billing"],
      ["Workspace", "Sam's", "/app/settings/members"],
      ["Groups", "", "/app/receipts/groups"],
      "appearance",
      ["Security", "Set up", "/app/settings/security"],
    ]);
  });

  it("says Protected once a second check is set up", () => {
    const rows = settingsRows({ planLabel: "Pro", workspaceName: "W", protectedAccount: true });
    expect(rows.at(-1)).toMatchObject({ label: "Security", value: "Protected" });
  });
});
