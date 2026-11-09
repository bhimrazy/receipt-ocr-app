import type { Usage } from "@/components/usage-meter";
import type { UpgradeLevel } from "./upgrade-event";

/** From this share of the allowance used, the meter turns amber and the upgrade offer is `near`. */
export const NEAR_RATIO = 0.8;
/** Below this share used, Home shows no upgrade card (the meter's button is the only surface). */
export const WARM_RATIO = 0.2;

/** Share of the allowance used, 0 to 1: the month, or the day when the plan has no monthly limit. */
export const usageRatio = ({ used, limit }: Pick<Usage, "used" | "limit">) =>
  limit > 0 ? Math.min(1, used / limit) : 0;

/**
 * How hard to offer Pro. `at`: uploads are refused by the day, the month or the Free pool.
 * Null when every plan is paused (the service-wide cap), since upgrading wouldn't help.
 */
export function upgradeLevel(usage: Pick<Usage, "used" | "limit" | "blocked">): UpgradeLevel | null {
  if (usage.blocked === "global") return null;
  if (usage.blocked) return "at";
  return usageRatio(usage) >= NEAR_RATIO ? "near" : "quiet";
}
