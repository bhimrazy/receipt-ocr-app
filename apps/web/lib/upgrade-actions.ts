"use server";

import { cookies } from "next/headers";
import { isProduction } from "./env";
import { track } from "./telemetry/analytics";
import { getActiveScope } from "./session";
import {
  dismiss,
  parseDismissals,
  UPGRADE_COOKIE,
  UPGRADE_COOKIE_MAX_AGE,
} from "./upgrade-dismissal";
import { isOneOf, UPGRADE_SURFACES, type UpgradeSurface } from "./upgrade-event";
import { getUpgradeOffer } from "./upgrade-offer";

/**
 * The owner's offer and who they are, or null: no offer, a member, or an admin signed in as
 * someone (the offer is null then too).
 */
async function ownerOffer() {
  const [offer, scope] = await Promise.all([getUpgradeOffer(), getActiveScope().catch(() => null)]);
  if (!offer || offer.audience !== "owner" || !scope || scope.impersonatedBy) return null;
  return { offer, scope };
}

/**
 * Records that the upgrade modal opened, as `upgrade_cta { action: "opened" }`. The level is
 * read on the server, not taken from the browser. Values outside the closed set send nothing.
 * Never throws.
 */
export async function recordUpgradeOpened(surface: UpgradeSurface): Promise<void> {
  if (!isOneOf(UPGRADE_SURFACES, surface)) return;
  const owner = await ownerOffer();
  if (!owner) return;
  track({
    name: "upgrade_cta",
    userId: owner.scope.userId,
    workspaceId: owner.scope.organizationId,
    props: { action: "opened", surface, level: owner.offer.level },
  });
}

/**
 * "Not now" on the Home card or the banner: hides it (see `dismiss` for how long) and records
 * `upgrade_cta { action: "dismissed" }`. Closing the modal is not a dismissal.
 */
export async function dismissUpgradeOffer(surface: "home" | "banner"): Promise<void> {
  if (surface !== "home" && surface !== "banner") return;
  const owner = await ownerOffer();
  if (!owner) return;
  const jar = await cookies();
  const next = dismiss(
    parseDismissals(jar.get(UPGRADE_COOKIE)?.value),
    surface,
    owner.offer.level,
    owner.offer.usage,
    Date.now(),
  );
  jar.set(UPGRADE_COOKIE, JSON.stringify(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/app",
    maxAge: UPGRADE_COOKIE_MAX_AGE,
  });
  track({
    name: "upgrade_cta",
    userId: owner.scope.userId,
    workspaceId: owner.scope.organizationId,
    props: { action: "dismissed", surface, level: owner.offer.level },
  });
}
