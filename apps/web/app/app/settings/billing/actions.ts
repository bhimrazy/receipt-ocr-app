"use server";

import { Billing } from "@receipt-ocr/core";
import { Effect, Exit, Cause, Option } from "effect";
import { canManageBilling } from "@/lib/billing";
import { errorFields, logger } from "@/lib/log";
import { runtime } from "@/lib/runtime";
import { getSession, requireActiveScope } from "@/lib/session";

export type PortalTarget = "overview" | "cancel" | "payment";

/**
 * A fresh Paddle customer portal link for the active workspace's subscription.
 * Owners only, and never while an admin is impersonating the owner. The link
 * carries a short-lived token, so it is made per click and not stored.
 */
export async function openBillingPortalAction(
  target: PortalTarget,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const [session, scope] = await Promise.all([getSession(), requireActiveScope()]);
  if (!session) return { ok: false, error: "Sign in again to manage billing." };
  if (!canManageBilling(scope.role)) {
    return { ok: false, error: "Only the workspace owner can manage billing." };
  }
  if (session.session.impersonatedBy) {
    return { ok: false, error: "Billing can't be managed while signed in as another user." };
  }
  const exit = await runtime.runPromiseExit(
    Effect.flatMap(Billing, (billing) => billing.portalLinks(scope.organizationId)),
  );
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    const tag = Option.isSome(failure) ? failure.value._tag : "Defect";
    logger.error({
      event: "billing.portal_failed",
      unit: "log",
      organization_id: scope.organizationId,
      user_id: session.user.id,
      error: errorFields(Option.isSome(failure) ? failure.value : Cause.squash(exit.cause)),
    });
    if (tag === "NotFound") return { ok: false, error: "This workspace has no subscription yet." };
    return { ok: false, error: "Paddle didn't answer. Try again in a minute." };
  }
  const links = exit.value;
  const url =
    target === "cancel"
      ? (links.cancel ?? links.overview)
      : target === "payment"
        ? (links.updatePaymentMethod ?? links.overview)
        : links.overview;
  return { ok: true, url };
}
