"use server";

import { hitRateLimit } from "@receipt-ocr/core";
import { cookies } from "next/headers";
import { isProduction } from "./env";
import { runtime } from "./runtime";
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

/** Calls one person may make per minute to these actions; past it they do nothing. */
const UPGRADE_CALLS_PER_MINUTE = 20;

/**
 * The owner's offer and who they are, or null: signed out, an admin signed in as someone, over
 * the per-user limit (checked before the offer's reads), no offer, or a member.
 */
async function ownerOffer() {
  const scope = await getActiveScope().catch(() => null);
  if (!scope || scope.impersonatedBy) return null;
  const { allowed } = await runtime
    .runPromise(hitRateLimit(`upgrade-cta:${scope.userId}`, 60_000, UPGRADE_CALLS_PER_MINUTE))
    .catch(() => ({ allowed: false }));
  if (!allowed) return null;
  const offer = await getUpgradeOffer();
  if (!offer || offer.audience !== "owner") return null;
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
