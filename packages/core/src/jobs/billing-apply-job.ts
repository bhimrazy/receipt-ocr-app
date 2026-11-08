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
