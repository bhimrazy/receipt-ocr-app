"use server";

import {
  Billing,
  hitRateLimit,
  providerErrorCode,
  UNVERIFIED_EMAIL,
  type Forbidden,
} from "@receipt-ocr/core";
import { Cause, Effect, Exit, Option } from "effect";
import { canManageBilling, getCheckoutFor } from "@/lib/billing";
import { billingSetupHint } from "@/lib/billing-setup-hint";
import { errorFields, logger } from "@/lib/log";
import { getUsageSummary } from "@/lib/receipts";
import { runtime } from "@/lib/runtime";
import { getSession, isAdmin, requireActiveScope } from "@/lib/session";
import { track } from "@/lib/telemetry/analytics";
import { CHECKOUT_VIAS, isOneOf, type CheckoutVia } from "@/lib/upgrade-event";
import { upgradeLevel } from "@/lib/upgrade-level";

export type PortalTarget = "overview" | "cancel" | "payment";

type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Clicks one person may make per minute on each billing button (each one calls Paddle). */
const BILLING_CLICKS_PER_MINUTE = 10;

/**
 * Who may act on the active workspace's billing: its owner, signed in as
 * themselves, under the per-user click limit. The error is what the button shows.
 */
async function billingCaller(action: "portal" | "checkout") {
  const [session, scope] = await Promise.all([getSession(), requireActiveScope()]);
  if (!session) return { ok: false, error: "Sign in again to manage billing." } as const;
  if (!canManageBilling(scope.role)) {
    return { ok: false, error: "Only the workspace owner can manage billing." } as const;
  }
  if (session.session.impersonatedBy) {
    return {
      ok: false,
      error: "Billing can't be managed while signed in as another user.",
    } as const;
  }
  const { allowed } = await runtime.runPromise(
    hitRateLimit(`billing-${action}:${session.user.id}`, 60_000, BILLING_CLICKS_PER_MINUTE),
  );
  if (!allowed)
    return { ok: false, error: "Too many tries. Wait a minute and try again." } as const;
  return { ok: true, session, scope } as const;
}

/** The tagged failure in a cause, or the defect. */
const failureOf = <E extends { _tag: string }>(cause: Cause.Cause<E>) => {
  const failure = Cause.failureOption(cause);
  return Option.isSome(failure)
    ? { tag: failure.value._tag, error: failure.value as unknown }
    : { tag: "Defect", error: Cause.squash(cause) };
};

/**
 * A fresh Paddle customer portal link for the active workspace's subscription.
 * Only its buyer, for the customer bound to them, never while an admin is impersonating. The link carries a
 * short-lived token, so it is made per click and not stored. Cancel and
 * payment open Paddle's page for this subscription; invoices open the overview.
 */
export async function openBillingPortalAction(
  target: PortalTarget,
): Promise<ActionResult<{ url: string }>> {
  const caller = await billingCaller("portal");
  if (!caller.ok) return caller;
  const { session, scope } = caller;
  const exit = await runtime.runPromiseExit(
    Effect.flatMap(Billing, (billing) =>
      billing.portalLinks(scope.organizationId, session.user.id),
    ),
  );
  if (Exit.isFailure(exit)) {
    const failure = failureOf(exit.cause);
    if (failure.tag === "NotFound") {
      return { ok: false, error: "This workspace has no subscription yet." };
    }
    if (failure.tag === "Forbidden") {
      return { ok: false, error: (failure.error as Forbidden).message };
    }
    logger.error({
      event: "billing.portal_failed",
      unit: "log",
      organization_id: scope.organizationId,
      user_id: session.user.id,
      billing: { provider_error_code: providerErrorCode(failure.error) },
      error: errorFields(failure.error),
    });
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

/**
 * Starts a Pro checkout for the active workspace: the server creates the
 * Paddle transaction with the configured price for `interval` and the
 * workspace and buyer in its custom data, and the browser opens that
 * transaction. Owners with a verified email only, at most a few a minute. `via` says which button started it, for
 * the `checkout_started` product event; anything outside the closed set is refused.
 * `workspaceId` is the workspace the page named: a tab left open after switching workspace
 * is refused rather than checking out a different one.
 */
export async function startCheckoutAction(
  interval: "month" | "year",
  via: CheckoutVia,
  workspaceId: string,
): Promise<ActionResult<{ transactionId: string }>> {
  if (interval !== "month" && interval !== "year") {
    return { ok: false, error: "Choose monthly or yearly." };
  }
  if (!isOneOf(CHECKOUT_VIAS, via)) return { ok: false, error: "Reload the page and try again." };
  const caller = await billingCaller("checkout");
  if (!caller.ok) return caller;
  const { session, scope } = caller;
  if (workspaceId !== scope.organizationId) {
    return { ok: false, error: "Your active workspace changed. Reload and try again." };
  }
  if (!session.user.emailVerified) return { ok: false, error: UNVERIFIED_EMAIL };
  if (!(await getCheckoutFor(isAdmin(session)))) {
    return { ok: false, error: "Paid plans aren't open yet." };
  }
  const exit = await runtime.runPromiseExit(
    Effect.flatMap(Billing, (billing) =>
      billing.createCheckout({
        organizationId: scope.organizationId,
        userId: session.user.id,
        interval,
      }),
    ),
  );
  if (Exit.isFailure(exit)) {
    const failure = failureOf(exit.cause);
    if (failure.tag === "Conflict")
      return { ok: false, error: "This workspace is already on Pro." };
    if (failure.tag === "NotConfigured") return { ok: false, error: "Paid plans aren't open yet." };
    if (failure.tag === "Forbidden") {
      return { ok: false, error: (failure.error as Forbidden).message };
    }
    const code = providerErrorCode(failure.error);
    logger.error({
      event: "billing.checkout_failed",
      unit: "log",
      organization_id: scope.organizationId,
      user_id: session.user.id,
      billing: { provider_error_code: code },
      error: errorFields(failure.error),
    });
    const hint = isAdmin(session) ? billingSetupHint(code) : null;
    return { ok: false, error: hint ?? "The checkout couldn't start. Try again in a minute." };
  }
  // Read on the server, not sent by the browser. Billing's own button has no level.
  const usage = via === "billing" ? null : await getUsageSummary().catch(() => null);
  const level = (usage && upgradeLevel(usage)) ?? "none";
  track({
    name: "checkout_started",
    userId: session.user.id,
    workspaceId: scope.organizationId,
    props: { interval, via, level },
  });
  return { ok: true, transactionId: exit.value.transactionId };
}
