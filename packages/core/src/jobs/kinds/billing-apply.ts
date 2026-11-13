import { Effect } from "effect";
import { PaddleApiError } from "../../billing/paddle";
import {
  applyBillingEvent,
  Billing,
  BillingPayloadError,
  type UnmatchedReason,
} from "../../billing/service";
import type { DbError } from "../../errors";
import type { Db } from "../../services";
import type { Settings } from "../../settings";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type JobFailure,
} from "../definition";
import {
  BILLING_APPLY_EVENT,
  billingApplyPayload,
  type BillingApplyPayload,
} from "../billing-apply-job";

/** Unmatched reasons that resolve on their own once the subscription or its transaction arrives. */
const WAITING: ReadonlySet<UnmatchedReason> = new Set([
  "no_transaction",
  "subscription",
  "transaction",
]);

/**
 * How long each retry waits at least while Paddle has the subscription locked:
 * with `maxAttempts` 8 the cancel is tried for about two hours, past a renewal's
 * processing. A dead job is not the last chance: every later event of a
 * revoked subscription asks for the cancel again.
 */
export const LOCKED_RETRY_MS = 15 * 60_000;

/** A stored payload the schema refuses is a bug: dead at once (it shows in the admin jobs list). */
const applyFailure = (error: DbError): JobFailure =>
  error.cause instanceof BillingPayloadError
    ? new NonRetryableJobError({ kind: "bad-payload" })
    : new RetryableJobError({ kind: "db-error" });

/**
 * Paddle refuses changes to a subscription while a renewal, payment or
 * scheduled change is in progress; these pass in minutes, so they retry.
 */
const LOCKED_CODES: ReadonlySet<string> = new Set([
  "subscription_locked_pending_changes",
  "subscription_locked_processing",
  "subscription_locked_renewal",
]);

/**
 * Cancels a revoked subscription with the provider. Billing off or a refused
 * key is dead at once (the admin jobs list shows it: cancel it in Paddle by
 * hand); a locked subscription (409 or a `subscription_locked_*` code) retries;
 * any other 4xx about the subscription itself (already canceled, gone) is
 * logged and done, since Pro is already off; anything else retries. A retry
 * finds the event applied and asks for the cancel again.
 */
export const cancelRevoked = (subscriptionId: string) =>
  Effect.flatMap(Billing, (billing) => billing.cancelNow(subscriptionId)).pipe(
    Effect.catchAll((error): Effect.Effect<void, JobFailure> => {
      if (error._tag === "NotConfigured") {
        return Effect.fail(new NonRetryableJobError({ kind: "billing-off" }));
      }
      const status = error.cause instanceof PaddleApiError ? error.cause.status : null;
      const code = annotateEvent({ billing: { provider_error_code: error.providerCode } });
      if (status === 401 || status === 403) {
        return code.pipe(
          Effect.zipRight(Effect.fail(new NonRetryableJobError({ kind: "provider-auth" }))),
        );
      }
      if (status === 409 || LOCKED_CODES.has(error.providerCode ?? "")) {
        return code.pipe(
          Effect.zipRight(
            Effect.fail(
              new RetryableJobError({ kind: "provider-locked", retryAfterMs: LOCKED_RETRY_MS }),
            ),
          ),
        );
      }
      // A cancel asked again after an earlier one went through: the goal is met.
      if (error.providerCode === "subscription_is_canceled_action_invalid") {
        return code.pipe(Effect.zipRight(Effect.logInfo("billing.cancel_already_canceled")));
      }
      if (status !== null && status >= 400 && status < 500 && status !== 429) {
        // A notice on the job's wide event, at error level.
        return code.pipe(
          Effect.zipRight(annotateEvent({ error: errorFields(error) })),
          Effect.zipRight(Effect.logError("billing.cancel_refused")),
        );
      }
      return code.pipe(
        Effect.zipRight(Effect.fail(new RetryableJobError({ kind: "provider-error" }))),
      );
    }),
  );

/**
 * Applies a stored webhook to its subscription, then, when a chargeback or a
 * full refund of the current period revoked Pro, cancels the subscription
 * with the provider so it can't charge again. A database error retries; a payload the schema refuses
 * goes dead instead of retrying forever.
 */
export const billingApply: JobDefinition<BillingApplyPayload, Db | Settings | Billing> = {
  kind: BILLING_APPLY_EVENT,
  payload: billingApplyPayload,
  maxAttempts: 8,
  leaseSeconds: 30,
  // The cap is also the most `LOCKED_RETRY_MS` can ask for.
  backoff: { baseMs: 5_000, capMs: 30 * 60_000 },

  run: (payload) =>
    applyBillingEvent(payload.eventId).pipe(
      Effect.tap((result) =>
        annotateEvent({
          ...(result.organizationId ? { organization_id: result.organizationId } : {}),
          // The buyer, so the product event has a person to attach to.
          ...(result.userId ? { user_id: result.userId } : {}),
          billing: {
            outcome: result.outcome,
            ...(result.unmatched ? { unmatched_reason: result.unmatched } : {}),
            ...(result.transactionId ? { transaction_id: result.transactionId } : {}),
            ...(result.orphanCharging ? { orphan_charging: true } : {}),
            ...(result.revokedCharged
              ? { revoked_charged: true, subscription_id: result.subscriptionId ?? null }
              : {}),
            ...(result.duplicate ? { duplicate_subscription: true } : {}),
            // The product event `plan_changed { from, to }`, for the upgrade funnel.
            ...(result.planChange
              ? { plan_from: result.planChange.from, plan_to: result.planChange.to }
              : {}),
          },
        }),
      ),
      // Error level, so it reaches Axiom and Sentry alerts.
      Effect.tap((result) =>
        result.orphanCharging ? Effect.logError("billing.orphan_charging") : Effect.void,
      ),
      // Warn level, to be seen and refunded by hand: the workspace may now be paying twice.
      Effect.tap((result) =>
        result.duplicate ? Effect.logWarning("billing.duplicate_subscription") : Effect.void,
      ),
      // Warn level, to be seen and refunded by hand: Pro was revoked, yet the provider charged for a period.
      Effect.tap((result) =>
        result.revokedCharged ? Effect.logWarning("billing.revoked_charged") : Effect.void,
      ),
      // The plan was kept: the price settings may be missing a price subscribers pay.
      Effect.tap((result) =>
        result.unknownPrice ? Effect.logWarning("billing.unknown_price") : Effect.void,
      ),
      // A refused link: someone may have paid without getting Pro, so warn level, to be seen and fixed by hand.
      Effect.tap((result) =>
        result.unmatched && !WAITING.has(result.unmatched)
          ? Effect.logWarning("billing.unmatched")
          : Effect.void,
      ),
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError(applyFailure),
      Effect.tap((result) =>
        result.cancelSubscriptionId ? cancelRevoked(result.cancelSubscriptionId) : Effect.void,
      ),
    ),
};
