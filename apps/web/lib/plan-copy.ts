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

/**
 * The scan line of a plan card: "20 scans a day and 100 a month for each member" (counted per
 * person) or "500 scans a month shared by the workspace, up to 200 a day".
 */
export function scansLine(policy: PlanPolicy): string {
  const day = policy.receiptsPerDay;
  const month = policy.receiptsPerMonth;
  if (policy.scope === "workspace") {
    return month === null
      ? `${n(day, "scan")} a day shared by the workspace`
      : `${n(month, "scan")} a month shared by the workspace, up to ${day} a day`;
  }
  return month === null
    ? `${n(day, "scan")} a day for each member`
    : `${n(day, "scan")} a day and ${month} a month for each member`;
}

/** "Up to 3 members": members of one workspace, pending invitations included. */
export const membersLine = (policy: PlanPolicy) =>
  `Up to ${n(policy.membersPerWorkspace, "member")}`;

export function freeFeatures(free: PlanPolicy): string[] {
  return [
    scansLine(free),
    membersLine(free),
    `${n(free.workspaces, "workspace")} to own`,
    "Merchant, items, tax and totals extracted",
    "Confidence scores and review flags",
    "Searchable history, CSV export and JSON copy",
  ];
}

export function proFeatures(pro: PlanPolicy): string[] {
  return [
    "Everything in Free",
    scansLine(pro),
    membersLine(pro),
    `Own up to ${n(pro.workspaces, "workspace")} (each upgraded separately)`,
    "Cancel any time",
  ];
}

/**
 * The Custom card, shared by the landing and pricing pages. No price and no self-serve features:
 * each line is arranged by hand after someone gets in touch.
 */
export const CUSTOM_PLAN = {
  name: "Custom",
  price: "Let's talk",
  description: "For higher volume, bigger teams and tailored setups.",
  features: [
    "Everything in Pro",
    "Higher monthly and daily limits",
    "More members and workspaces",
    "A direct line to the team",
    "Shape the roadmap with your feedback",
  ],
  cta: "Contact us",
} as const;

/** For an owner with a Pro workspace looking at one of their Free ones (billing page, settings). */
export const SEPARATE_UPGRADE =
  "This workspace is on Free. Your Pro subscription covers one workspace; each workspace is upgraded separately.";

/**
 * The welcome email's plan line: "Your Free plan includes 20 scans a day, up to 100 a month. …".
 * A shared Pro allowance still says so; a Free one is the reader's own.
 */
export function welcomePlanLine(plan: "free" | "pro", policy: PlanPolicy): string {
  const name = plan === "pro" ? "Pro" : "Free";
  const owner = policy.scope === "workspace" ? `, ${allowanceOwner(policy)}` : "";
  return `Your ${name} plan includes ${allowance(policy)}${owner}. Limits reset at 00:00 UTC.`;
}

/** Under the workspace switcher when the user can't create another workspace. */
export function workspaceCapNote(plan: "free" | "pro", limit: number): string {
  return plan === "pro"
    ? `You own ${n(limit, "workspace")}, the most on Pro.`
    : `Free accounts own ${n(limit, "workspace")}. Upgrade a workspace to Pro to create another.`;
}
