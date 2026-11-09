import type { SettingsLink } from "@/components/settings-list";

/** The phone Settings list, top to bottom: each row's current value comes from the page's data. */
export function settingsRows(input: {
  planLabel: string;
  workspaceName: string;
  protectedAccount: boolean;
}): (SettingsLink | "appearance")[] {
  return [
    { href: "/app/settings/billing", label: "Plan", value: input.planLabel, icon: "plan" },
    {
      href: "/app/settings/members",
      label: "Workspace",
      value: input.workspaceName,
      icon: "workspace",
    },
    "appearance",
    {
      href: "/app/settings/security",
      label: "Security",
      value: input.protectedAccount ? "Protected" : "Set up",
      icon: "security",
    },
  ];
}
