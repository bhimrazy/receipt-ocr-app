import { Effect } from "effect";
import { PaddleApiError } from "../../billing/paddle";
import { applyBillingEvent, Billing, BillingPayloadError } from "../../billing/service";
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

/** A stored payload the schema refuses is a bug: dead at once (it shows in the admin jobs list). */
const applyFailure = (error: DbError): JobFailure =>
  error.cause instanceof BillingPayloadError
    ? new NonRetryableJobError({ kind: "bad-payload" })
    : new RetryableJobError({ kind: "db-error" });

/**
 * Cancels a revoked subscription with the provider. Billing off or a refused
 * key is dead at once (the admin jobs list shows it: cancel it in Paddle by
 * hand); a 4xx about the subscription itself (already canceled, gone) is logged
 * and done, since Pro is already off; anything else retries. A retry finds the
 * event applied and asks for the cancel again.
 */
const cancelRevoked = (subscriptionId: string) =>
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
 * Applies a stored webhook to its subscription, then, when a chargeback or
 * full refund revoked Pro, cancels the subscription with the provider so it
 * can't charge again. A database error retries; a payload the schema refuses
 * goes dead instead of retrying forever.
 */
export const billingApply: JobDefinition<BillingApplyPayload, Db | Settings | Billing> = {
  kind: BILLING_APPLY_EVENT,
  payload: billingApplyPayload,
  maxAttempts: 8,
  leaseSeconds: 30,
  backoff: { baseMs: 5_000, capMs: 10 * 60_000 },

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
            ...(result.orphanCharging ? { orphan_charging: true } : {}),
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
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError(applyFailure),
      Effect.tap((result) =>
        result.cancelSubscriptionId ? cancelRevoked(result.cancelSubscriptionId) : Effect.void,
      ),
    ),
};
