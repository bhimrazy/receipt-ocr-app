import type { Usage } from "@/components/usage-meter";
import { storageIsFull, storageShows } from "./storage-usage";
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

/**
 * What storage from NEAR_RATIO offers, by the same rules: on Free, Upgrade (a button once full)
 * for an owner who can buy, the owner for a member, "opens soon" while checkout is closed; on Pro,
 * Contact us for the owner once full.
 */
export function storageAction({
  usage,
  plan,
  owner,
  audience,
}: {
  usage: Pick<Usage, "storage">;
  plan: PlanId;
  owner: boolean;
  audience: "owner" | "member" | null;
}): MeterAction | null {
  if (!storageShows(usage.storage)) return null;
  const full = storageIsFull(usage.storage);
  if (plan === "pro") return owner && full ? "contact" : null;
  if (audience === "member") return "ask-owner";
  if (audience === "owner") return full ? "upgrade-button" : "upgrade-link";
  return "opens-soon";
}

const STRENGTH: MeterAction[] = [
  "upgrade-button",
  "contact",
  "upgrade-link",
  "ask-owner",
  "opens-soon",
];

/** The card's and the phone strip's action, from scans and storage together. */
export const usageAction = (
  input: Parameters<typeof meterAction>[0] & { usage: Pick<Usage, "storage"> },
) => pickAction(meterAction(input), storageAction(input));

/**
 * The one action a surface shows for scans and storage together: the stronger of the two, and
 * which one it came from, for its words.
 */
export function pickAction(
  scans: MeterAction | null,
  storage: MeterAction | null,
): { action: MeterAction; for: "scans" | "storage" } | null {
  if (scans === null) return storage === null ? null : { action: storage, for: "storage" };
  if (storage === null || STRENGTH.indexOf(scans) <= STRENGTH.indexOf(storage))
    return { action: scans, for: "scans" };
  return { action: storage, for: "storage" };
}
