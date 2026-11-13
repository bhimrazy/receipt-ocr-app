import type { SettingsLink } from "@/components/settings-list";

/** The phone Settings list, top to bottom: each row's current value comes from the page's data. */
export function settingsRows(input: {
  /** "Free · 85 / 100 scans". */
  planSummary: string;
  workspaceName: string;
  protectedAccount: boolean;
}): (SettingsLink | "appearance")[] {
  return [
    {
      href: "/app/settings/billing",
      label: "Plan and billing",
      value: input.planSummary,
      icon: "plan",
    },
    {
      href: "/app/settings/members",
      label: "Workspace",
      value: input.workspaceName,
      icon: "workspace",
    },
    { href: "/app/receipts/groups", label: "Groups", value: "", icon: "groups" },
    "appearance",
    {
      href: "/app/settings/security",
      label: "Security",
      value: input.protectedAccount ? "Protected" : "Set up",
      icon: "security",
    },
  ];
}
