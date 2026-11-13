import { z } from "zod";
import type { NewJob } from "./definition";

/** Applies one stored billing webhook (`billing_events` row) to its subscription. */
export const BILLING_APPLY_EVENT = "billing.apply_event";

export const billingApplyPayload = z.object({ eventId: z.uuid() });

export type BillingApplyPayload = z.infer<typeof billingApplyPayload>;

/** Keyed by the event row, so a job can't be enqueued twice for one event. */
export const billingApplyJob = (payload: BillingApplyPayload): NewJob => ({
  kind: BILLING_APPLY_EVENT,
  payload,
  priority: 0,
  maxAttempts: 8,
  idempotencyKey: `billing:event:${payload.eventId}`,
});

/** Checks, once, whether a full refund kept waiting for its transaction ever resolved. */
export const BILLING_REFUND_WAIT_CHECK = "billing.refund_wait_check";

/**
 * Paddle retries a failed live delivery for about two days (developer.paddle.com, "Respond
 * to webhooks", checked 2026-11-13). A refund still waiting a day past that won't resolve
 * on its own.
 */
export const REFUND_WAIT_ALERT_MS = 3 * 86_400_000;

/** Runs after maintenance work: nothing waits on it. */
const PRIORITY_CHECK = 9;

/** Keyed by the refund's event row, so a retried apply enqueues one check. */
export const refundWaitCheckJob = (payload: BillingApplyPayload, now: Date): NewJob => ({
  kind: BILLING_REFUND_WAIT_CHECK,
  payload,
  priority: PRIORITY_CHECK,
  maxAttempts: 8,
  idempotencyKey: `billing:refund-wait:${payload.eventId}`,
  runAt: new Date(now.getTime() + REFUND_WAIT_ALERT_MS),
});
