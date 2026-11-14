import type { Usage } from "@/components/usage-meter";
import type { PlanId } from "./plans";
import { NEAR_RATIO, usageRatio } from "./upgrade-level";

/**
 * What the usage card offers under its note. `upgrade-button` only once the month is used up;
 * `upgrade-link` from NEAR_RATIO of the month, once today's limit is used up, or while the Free
 * pool is full; `opens-soon` replaces either while checkout is closed to the viewer; `contact` is
 * a Pro owner's way past a used-up month.
 */
export type MeterAction =
  "upgrade-button" | "upgrade-link" | "ask-owner" | "opens-soon" | "contact";

export function meterAction({
  usage,
  plan,
  owner,
  audience,
}: {
  usage: Pick<Usage, "used" | "limit" | "blocked" | "period">;
  plan: PlanId;
  /** The viewer owns the workspace. */
  owner: boolean;
  /** Who the upgrade offer is for (`getUpgradeOffer`); null while checkout is closed to the viewer. */
  audience: "owner" | "member" | null;
}): MeterAction | null {
  if (usage.blocked === "global") return null;
  if (plan === "pro") return owner && usage.blocked === "month" ? "contact" : null;
  const monthUsedUp =
    usage.blocked === "month" || (usage.period === "day" && usage.blocked === "day");
  const offer =
    monthUsedUp ||
    usage.blocked === "day" ||
    usage.blocked === "pool" ||
    usageRatio(usage) >= NEAR_RATIO;
  if (!offer) return null;
  if (audience === "member") return usage.blocked === "pool" ? null : "ask-owner";
  if (audience === "owner") return monthUsedUp ? "upgrade-button" : "upgrade-link";
  return "opens-soon";
}
