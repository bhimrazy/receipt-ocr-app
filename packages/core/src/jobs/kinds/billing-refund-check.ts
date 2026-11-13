import { Effect } from "effect";
import { waitingRefund } from "../../billing/service";
import type { Db } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import { RetryableJobError, type JobDefinition } from "../definition";
import {
  BILLING_REFUND_WAIT_CHECK,
  billingApplyPayload,
  type BillingApplyPayload,
} from "../billing-apply-job";

/**
 * Runs `REFUND_WAIT_ALERT_MS` after a full refund was kept waiting for its transaction. One
 * still waiting logs `billing.refund_unresolved` at warn level, once: Pro stays on until
 * someone finds the transaction in Paddle. A resolved one logs nothing.
 */
export const billingRefundCheck: JobDefinition<BillingApplyPayload, Db> = {
  kind: BILLING_REFUND_WAIT_CHECK,
  payload: billingApplyPayload,
  maxAttempts: 8,
  leaseSeconds: 30,
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: (payload) =>
    waitingRefund(payload.eventId).pipe(
      Effect.tap((waiting) =>
        waiting
          ? annotateEvent({
              ...(waiting.organizationId ? { organization_id: waiting.organizationId } : {}),
              billing: {
                outcome: "unmatched",
                unmatched_reason: "transaction",
                subscription_id: waiting.subscriptionId,
                transaction_id: waiting.transactionId,
                refund_unresolved: true,
              },
            }).pipe(Effect.zipRight(Effect.logWarning("billing.refund_unresolved")))
          : Effect.void,
      ),
      Effect.map((waiting) => ({ unresolved: waiting !== null })),
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError(() => new RetryableJobError({ kind: "db-error" })),
    ),
};
