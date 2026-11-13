import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import {
  canManageBilling,
  checkoutOpenToEveryone,
  getCheckoutConfig,
  getCheckoutFor,
} from "./billing";
import { errorFields, logger } from "./log";
import { getCurrentPlan, getPlanTable } from "./plan-limits";
import { getUsageSummary } from "./receipts";
import { getActiveScope, getSession, isAdmin } from "./session";
import { parseDismissals, UPGRADE_COOKIE } from "./upgrade-dismissal";
import { decideUpgradeOffer, type UpgradeOffer } from "./upgrade-level";
import { listWorkspaces } from "./workspaces";

/**
 * The upgrade offer for the active workspace, or null (see `decideUpgradeOffer`). Every
 * surface reads this one value. Deduplicated per request; the plan and usage reads are shared
 * with the meter and Home. A failed read means no offer; only Next's own errors propagate.
 */
export const getUpgradeOffer = cache(async (): Promise<UpgradeOffer | null> => {
  try {
    const [session, scope] = await Promise.all([getSession(), getActiveScope()]);
    if (!session || !scope) return null;
    const [{ plan }, usage, plans, config, checkout, workspaces, jar] = await Promise.all([
      getCurrentPlan(),
      getUsageSummary(),
      getPlanTable(),
      getCheckoutConfig(),
      getCheckoutFor(isAdmin(session)),
      listWorkspaces(),
      cookies(),
    ]);
    return decideUpgradeOffer({
      plan,
      impersonating: Boolean(session.session.impersonatedBy),
      owner: canManageBilling(scope.role),
      usage,
      checkout: checkout
        ? {
            settings: {
              environment: checkout.config.environment,
              clientToken: checkout.config.clientToken,
            },
            testMode: checkout.testMode,
          }
        : null,
      openToEveryone: checkoutOpenToEveryone(config),
      plans,
      workspaceId: scope.organizationId,
      workspaceName:
        workspaces.find((w) => w.id === scope.organizationId)?.name ?? "this workspace",
      dismissals: parseDismissals(jar.get(UPGRADE_COOKIE)?.value),
      now: Date.now(),
    });
  } catch (error) {
    // Next's own signals (a prerender bailing out on cookies(), redirects) must pass through.
    unstable_rethrow(error);
    logger.error({ event: "app.upgrade_offer_failed", unit: "log", error: errorFields(error) });
    return null;
  }
});
