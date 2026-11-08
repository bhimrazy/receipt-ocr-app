"use server";

import { track } from "./telemetry/analytics";
import { getActiveScope } from "./session";
import {
  INSTALL_ACTIONS,
  INSTALL_PLATFORMS,
  INSTALL_SURFACES,
  type InstallOfferEvent,
} from "./install-offer-event";

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

/**
 * Records one install-offer interaction as the `install_offer` product event. Signed-out
 * visitors and admins impersonating a user send nothing; values outside the closed sets are
 * dropped. Never throws.
 */
export async function recordInstallOffer(event: InstallOfferEvent): Promise<void> {
  if (
    !isOneOf(INSTALL_ACTIONS, event?.action) ||
    !isOneOf(INSTALL_SURFACES, event.surface) ||
    !isOneOf(INSTALL_PLATFORMS, event.platform)
  )
    return;
  const scope = await getActiveScope().catch(() => null);
  if (!scope || scope.impersonatedBy) return;
  track({
    name: "install_offer",
    userId: scope.userId,
    workspaceId: scope.organizationId,
    props: { action: event.action, surface: event.surface, platform: event.platform },
  });
}
