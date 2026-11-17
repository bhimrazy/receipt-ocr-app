import { formatStorage, type PlanPolicy } from "@receipt-ocr/core/plans";

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
 * The scan line of a plan card: "50 scans a month per workspace, up to 20 a day", or "20 scans a
 * day and 100 a month for each member" when counted per person.
 */
export function scansLine(policy: PlanPolicy): string {
  const day = policy.receiptsPerDay;
  const month = policy.receiptsPerMonth;
  if (policy.scope === "workspace") {
    return month === null
      ? `${n(day, "scan")} a day per workspace`
      : `${n(month, "scan")} a month per workspace, up to ${day} a day`;
  }
  return month === null
    ? `${n(day, "scan")} a day for each member`
    : `${n(day, "scan")} a day and ${month} a month for each member`;
}

/** "Up to 2 members": members of one workspace, pending invitations included. */
export const membersLine = (policy: PlanPolicy) =>
  `Up to ${n(policy.membersPerWorkspace, "member")}`;

/** "100 MB of receipt storage", per workspace. */
export const storageLine = (policy: PlanPolicy) =>
  `${formatStorage(policy.storageBytes)} of receipt storage`;

/**
 * Every plan card lists scans, members, storage and workspaces first, in that order, so Free and
 * Pro line up.
 */
export function freeFeatures(free: PlanPolicy): string[] {
  return [
    scansLine(free),
    membersLine(free),
    storageLine(free),
    `${n(free.workspaces, "workspace")} to own`,
    "Merchant, date, items, tax and totals, with review flags",
    "Searchable history, CSV export and JSON copy",
  ];
}

export function proFeatures(pro: PlanPolicy): string[] {
  return [
    scansLine(pro),
    membersLine(pro),
    storageLine(pro),
    `Own up to ${n(pro.workspaces, "workspace")}, each upgraded separately`,
    ...(pro.poolPerDay === null ? ["Not limited by Free's shared daily capacity"] : []),
    "Everything in Free",
  ];
}

/**
 * The Custom card, shared by the landing and pricing pages. No price and no self-serve features:
 * each line is arranged by hand after someone gets in touch.
 */
export const CUSTOM_PLAN = {
  name: "Custom",
  price: "Let's talk",
  description:
    "For teams that need more than Pro. Tell us what you need and we'll say plainly what we can do.",
  features: ["Everything in Pro", "Higher limits on request, where we can arrange them"],
  cta: "Contact us",
} as const;

/** For an owner with a Pro workspace looking at one of their Free ones (billing page, settings). */
export const SEPARATE_UPGRADE =
  "This workspace is on Free. Your Pro subscription covers one workspace; each workspace is upgraded separately.";

/** The pricing headline on /pricing and the landing page; it promises an upgrade only once one can be bought. */
export const pricingHeadline = (checkoutOpen: boolean) =>
  checkoutOpen
    ? "Start free. Upgrade a workspace when it needs more."
    : "Start free. Pro opens soon for workspaces that need more.";

/**
 * The welcome email's plan line: "Your Free plan includes 50 scans a month per workspace, up to 20
 * a day. …".
 */
export function welcomePlanLine(plan: "free" | "pro", policy: PlanPolicy): string {
  const name = plan === "pro" ? "Pro" : "Free";
  const scans = policy.scope === "workspace" ? scansLine(policy) : allowance(policy);
  return `Your ${name} plan includes ${scans}. Limits reset at 00:00 UTC.`;
}

/**
 * Under the workspace switcher when the user can't create another workspace. States the Pro
 * allowance as a fact, never as an instruction, since the switcher has no upgrade control.
 */
export function workspaceCapNote(plan: "free" | "pro", limit: number, proLimit: number): string {
  if (plan === "pro") return `You own ${n(limit, "workspace")}, the most on Pro.`;
  const free = `Free accounts own ${n(limit, "workspace")}.`;
  return proLimit > limit ? `${free} Pro owners can have ${proLimit}.` : free;
}
