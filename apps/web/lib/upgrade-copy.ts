import type { Usage } from "@/components/usage-meter";
import { formatTime } from "./format";
import { allowance } from "./plan-copy";
import type { PlanPolicy, PlanTable } from "./plans";
import { PRO_PRICE_LABEL } from "./pricing";

/**
 * Words for the upgrade surfaces, built from the saved plan limits, the price and the usage
 * itself; no numbers of its own. Client-safe.
 */

/** "1 December": the day a monthly allowance resets (always 00:00 UTC). */
export const resetDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

const span = (usage: Pick<Usage, "period">) => (usage.period === "month" ? "this month" : "today");

/** What a member sees at the limit, and next to an amber meter, instead of an offer. */
export const ASK_OWNER = "Ask the workspace owner to upgrade this workspace to Pro.";

/** "Pro gives this workspace 500 scans a month, up to 200 a day, shared by its members" */
const proGives = (pro: PlanPolicy) =>
  `Pro gives this workspace ${allowance(pro)}, shared by its members`;

export type HomeCardCopy = { badge: string; title: string; body: string; action: string };

/** The Home card: calm below NEAR_RATIO, specific from it. */
export function homeCardCopy(level: "quiet" | "near", usage: Usage, pro: PlanPolicy): HomeCardCopy {
  const { used, limit } = usage;
  if (level === "quiet") {
    return {
      badge: "Free plan",
      title: "Pro for this workspace",
      body: `${used} of ${limit} Free scans used ${span(usage)}. ${proGives(pro)}.`,
      action: `See Pro, ${PRO_PRICE_LABEL.month} a month`,
    };
  }
  const reset =
    usage.period === "month"
      ? `They reset on ${resetDay(usage.resetsAt)} at 00:00 UTC.`
      : "They reset at 00:00 UTC.";
  return {
    badge: `${used} of ${limit} used`,
    title: `You've used ${used} of ${limit} Free scans ${span(usage)}`,
    body: `${reset} ${proGives(pro)}, for ${PRO_PRICE_LABEL.month} a month.`,
    action: "Upgrade to Pro",
  };
}

/** The page banner while uploads are blocked; null for the service-wide cap (no banner then). */
export function bannerCopy(usage: Usage, pro: PlanPolicy): { body: string; opens: string } | null {
  if (usage.blocked === "month") {
    const opens = resetDay(usage.opensAt);
    return {
      body: `You've used all ${usage.limit} Free scans this month. Uploads open on ${opens}. Pro gives this workspace ${allowance(pro)}.`,
      opens,
    };
  }
  if (usage.blocked === "day") {
    const opens = formatTime(usage.opensAt);
    return {
      body: `You've used today's ${usage.day?.limit ?? usage.limit} Free scans. Uploads open at ${opens}. Pro allows up to ${pro.receiptsPerDay} a day in this workspace.`,
      opens,
    };
  }
  if (usage.blocked === "pool") {
    return {
      body: "Free scanning is busy today: the shared Free capacity is used up. Pro workspaces don't use it.",
      opens: formatTime(usage.opensAt),
    };
  }
  return null;
}

/** The sentence the upload panel's limit state adds for an owner (the pool's body already names Pro). */
export function limitUpgradeLine(usage: Usage, pro: PlanPolicy): string | null {
  if (usage.blocked === "month") return `Or upgrade this workspace to Pro for ${allowance(pro)}.`;
  if (usage.blocked === "day")
    return `Pro allows up to ${pro.receiptsPerDay} a day in this workspace.`;
  return null;
}

/** "84 / 100 used this month", the modal's eyebrow. */
export const usedLine = (usage: Usage) => `${usage.used} / ${usage.limit} used ${span(usage)}`;

export type ComparisonRow = { label: string; free: string; pro: string };

const scansCell = (policy: PlanPolicy, count: number | null) =>
  count === null
    ? "No limit"
    : `${count} ${policy.scope === "workspace" ? "shared" : "per person"}`;

/** The modal's Free and Pro comparison: five rows, every number from the saved plan table. */
export function comparisonRows({ free, pro }: PlanTable): ComparisonRow[] {
  return [
    {
      label: "Scans a month",
      free: scansCell(free, free.receiptsPerMonth),
      pro: scansCell(pro, pro.receiptsPerMonth),
    },
    { label: "Scans a day", free: String(free.receiptsPerDay), pro: String(pro.receiptsPerDay) },
    {
      label: "Members per workspace",
      free: String(free.membersPerWorkspace),
      pro: String(pro.membersPerWorkspace),
    },
    { label: "Workspaces you can own", free: String(free.workspaces), pro: String(pro.workspaces) },
    {
      label: "Busy-day pauses",
      free: free.poolPerDay === null ? "Never" : "Can pause on busy days",
      pro: pro.poolPerDay === null ? "Never" : "Can pause on busy days",
    },
  ];
}
