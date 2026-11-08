import { Effect } from "effect";
import { applyBillingEvent } from "../../billing/service";
import type { Db } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import { RetryableJobError, type JobDefinition } from "../definition";
import {
  BILLING_APPLY_EVENT,
  billingApplyPayload,
  type BillingApplyPayload,
} from "../billing-apply-job";

/**
 * Applies a stored webhook to its subscription. A database error retries; a
 * payload the schema refuses is a bug, so it goes dead (and shows in the
 * admin jobs list) instead of retrying forever.
 */
export const billingApply: JobDefinition<BillingApplyPayload, Db> = {
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
          ...("userId" in result && result.userId ? { user_id: result.userId } : {}),
          billing: {
            outcome: result.outcome,
            // The product event `plan_changed { from, to }`, for the upgrade funnel.
            ...("planChange" in result && result.planChange
              ? { plan_from: result.planChange.from, plan_to: result.planChange.to }
              : {}),
          },
        }),
      ),
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError(() => new RetryableJobError({ kind: "db-error" })),
    ),
};
