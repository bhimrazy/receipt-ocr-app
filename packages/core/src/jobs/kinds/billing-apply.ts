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
      Effect.tap(({ outcome, organizationId }) =>
        annotateEvent({
          ...(organizationId ? { organization_id: organizationId } : {}),
          billing: { outcome },
        }),
      ),
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError(() => new RetryableJobError({ kind: "db-error" })),
    ),
};
