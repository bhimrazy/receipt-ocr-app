"use server";

import { Billing, hitRateLimit } from "@receipt-ocr/core";
import { Cause, Effect, Exit, Option } from "effect";
import { canManageBilling, getCheckoutFor } from "@/lib/billing";
import { errorFields, logger } from "@/lib/log";
import { runtime } from "@/lib/runtime";
import { getSession, isAdmin, requireActiveScope } from "@/lib/session";

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
 * Only its buyer, never while an admin is impersonating. The link carries a
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
      return { ok: false, error: "Only the person who subscribed can manage this subscription." };
    }
    logger.error({
      event: "billing.portal_failed",
      unit: "log",
      organization_id: scope.organizationId,
      user_id: session.user.id,
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
 * transaction. Owners only, at most a few a minute.
 */
export async function startCheckoutAction(
  interval: "month" | "year",
): Promise<ActionResult<{ transactionId: string }>> {
  if (interval !== "month" && interval !== "year") {
    return { ok: false, error: "Choose monthly or yearly." };
  }
  const caller = await billingCaller("checkout");
  if (!caller.ok) return caller;
  const { session, scope } = caller;
  if (!(await getCheckoutFor(isAdmin(session)))) {
    return { ok: false, error: "Paid plans aren't open yet." };
  }
  const exit = await runtime.runPromiseExit(
    Effect.flatMap(Billing, (billing) =>
      billing.createCheckout({
        organizationId: scope.organizationId,
        userId: session.user.id,
        email: session.user.email,
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
      return { ok: false, error: "Only the workspace owner can upgrade it." };
    }
    logger.error({
      event: "billing.checkout_failed",
      unit: "log",
      organization_id: scope.organizationId,
      user_id: session.user.id,
      error: errorFields(failure.error),
    });
    return { ok: false, error: "The checkout couldn't start. Try again in a minute." };
  }
  return { ok: true, transactionId: exit.value.transactionId };
}
