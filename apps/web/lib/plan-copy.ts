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
  return [
    `${allowance(pro)}, ${allowanceOwner(pro)}`,
    `Up to ${n(pro.workspaces, "workspace")} to own; each needs its own Pro`,
    "Everything in Free",
    "Cancel any time",
  ];
}
