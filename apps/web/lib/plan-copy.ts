import type { PlanPolicy } from "@receipt-ocr/core/plans";

/**
 * What each plan includes, worded from the limits an admin saved (Admin →
 * Settings, defaults in packages/core/src/plans.ts), for the landing, pricing
 * and billing pages. No numbers of its own. Client-safe: no server imports.
 */

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "20 scans a day, up to 100 a month" or "500 scans a month, up to 200 a day". */
export function allowance(policy: PlanPolicy): string {
  if (policy.receiptsPerMonth === null) return `${n(policy.receiptsPerDay, "scan")} a day`;
  return policy.scope === "workspace"
    ? `${n(policy.receiptsPerMonth, "scan")} a month, up to ${policy.receiptsPerDay} a day`
    : `${n(policy.receiptsPerDay, "scan")} a day, up to ${policy.receiptsPerMonth} a month`;
}

/** Who the allowance belongs to, as a plan card states it. */
export const allowanceOwner = (policy: PlanPolicy) =>
  policy.scope === "workspace" ? "for the workspace, shared by its members" : "per person";

export function freeFeatures(free: PlanPolicy): string[] {
  return [
    `${allowance(free)}, ${allowanceOwner(free)}`,
    `${n(free.workspaces, "workspace")} to own`,
    "Merchant, items, tax and totals extracted",
    "Confidence scores and review flags",
    "Searchable history, CSV export and JSON copy",
  ];
}

export function proFeatures(pro: PlanPolicy): string[] {
  const perWorkspace =
    pro.scope === "workspace" && pro.receiptsPerMonth !== null
      ? [
          `${n(pro.receiptsPerMonth, "scan")} a month per workspace, up to ${pro.receiptsPerDay} a day`,
          "Shared by everyone in the workspace",
        ]
      : [`${allowance(pro)}, ${allowanceOwner(pro)}`];
  return [
    "Everything in Free",
    "1 workspace",
    ...perWorkspace,
    `Own up to ${n(pro.workspaces, "workspace")} (each upgraded separately)`,
    "Cancel any time",
  ];
}

/** For an owner with a Pro workspace looking at one of their Free ones (billing page, settings). */
export const SEPARATE_UPGRADE =
  "This workspace is on Free. Your Pro subscription covers one workspace; each workspace is upgraded separately.";

/** The welcome email's plan line: "Your Free plan includes 20 scans a day, up to 100 a month, per person. …" */
export function welcomePlanLine(plan: "free" | "pro", policy: PlanPolicy): string {
  const name = plan === "pro" ? "Pro" : "Free";
  return `Your ${name} plan includes ${allowance(policy)}, ${allowanceOwner(policy)}. Limits reset at 00:00 UTC.`;
}

/** Under the workspace switcher when the user can't create another workspace. */
export function workspaceCapNote(plan: "free" | "pro", limit: number): string {
  return plan === "pro"
    ? `You own ${n(limit, "workspace")}, the most on Pro.`
    : `Free accounts own ${n(limit, "workspace")}. Upgrade a workspace to Pro to create another.`;
}
