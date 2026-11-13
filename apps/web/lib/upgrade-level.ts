import type { CheckoutSettings } from "@/components/billing/paddle-js";
import type { Usage } from "@/components/usage-meter";
import type { PlanId, PlanPolicy, PlanTable } from "./plans";
import type { UpgradeLevel } from "./upgrade-event";
import { bannerDismissed, homeDismissed, type Dismissals } from "./upgrade-dismissal";

/** From this share of the allowance used, the meter turns amber and the upgrade offer is `near`. */
export const NEAR_RATIO = 0.8;

/** Share of the allowance used, 0 to 1: the month, or the day when the plan has no monthly limit. */
export const usageRatio = ({ used, limit }: Pick<Usage, "used" | "limit">) =>
  limit > 0 ? Math.min(1, used / limit) : 0;

/**
 * How hard to offer Pro. `at`: uploads are refused by the day, the month or the Free pool.
 * Null when every plan is paused (the service-wide cap), since upgrading wouldn't help.
 */
export function upgradeLevel(
  usage: Pick<Usage, "used" | "limit" | "blocked">,
): UpgradeLevel | null {
  if (usage.blocked === "global") return null;
  if (usage.blocked) return "at";
  return usageRatio(usage) >= NEAR_RATIO ? "near" : "quiet";
}

/**
 * What the upgrade surfaces show, from `getUpgradeOffer()`. `owner`: the workspace's owner,
 * who can buy; everyone else (admins included) is a `member` and only gets the at-limit line.
 */
export type UpgradeOffer = {
  level: UpgradeLevel;
  audience: "owner" | "member";
  usage: Usage;
  free: PlanPolicy;
  pro: PlanPolicy;
  /** The workspace this offer is for; checkout is refused if the active one changes. */
  workspaceId: string;
  workspaceName: string;
  dismissed: { home: boolean; banner: boolean };
  /** Paddle's public settings; owners only. `testMode`: sandbox keys on the live site (admins). */
  checkout: { settings: CheckoutSettings; testMode: boolean } | null;
};

export type OfferInput = {
  plan: PlanId;
  impersonating: boolean;
  owner: boolean;
  usage: Usage | null;
  /** The checkout this viewer may use (`getCheckoutFor`): null while billing is off, or closed to them. */
  checkout: { settings: CheckoutSettings; testMode: boolean } | null;
  /** Whether anyone may buy Pro now (`checkoutOpenToEveryone`); decides whether members hear about it. */
  openToEveryone: boolean;
  /** The workspace has a subscription that can still charge (`workspaceCheckoutBlocked`): checkout is refused. */
  checkoutBlocked: boolean;
  plans: PlanTable;
  workspaceId: string;
  workspaceName: string;
  dismissals: Dismissals;
  now: number;
};

/**
 * The one gate for every upgrade surface. Null for a workspace that isn't Free (comps
 * included), while an admin is signed in as someone, when the viewer can't buy (billing off,
 * or sandbox keys on the live site for a non-admin), while the workspace has a subscription
 * that can still charge (past due after grace, or paused), and when every plan is paused.
 */
export function decideUpgradeOffer(input: OfferInput): UpgradeOffer | null {
  if (input.plan !== "free" || input.impersonating || !input.usage) return null;
  if (input.checkoutBlocked) return null;
  const level = upgradeLevel(input.usage);
  if (!level) return null;
  if (input.owner ? !input.checkout : !input.openToEveryone) return null;
  return {
    level,
    audience: input.owner ? "owner" : "member",
    usage: input.usage,
    free: input.plans.free,
    pro: input.plans.pro,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    dismissed: {
      home: homeDismissed(input.dismissals, level, input.now),
      banner: bannerDismissed(input.dismissals, input.now),
    },
    checkout: input.owner ? input.checkout : null,
  };
}
