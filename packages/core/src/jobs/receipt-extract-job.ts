import { z } from "zod";
import type { NewJob } from "./definition";

/** Reads one round of one receipt: an upload, or a user's retry. */
export const RECEIPT_EXTRACT = "receipt.extract";

/** Automatic attempts per round (roughly 10 s, 20 s, 40 s apart), then the receipt fails. */
export const RECEIPT_EXTRACT_MAX_ATTEMPTS = 4;

/** Priorities: lower runs first. */
export const PRIORITY_INTERACTIVE = 0;
export const PRIORITY_BULK = 5;

export const receiptExtractPayload = z.object({
  receiptId: z.uuid(),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  /** `receipts.attempts` when enqueued; the job may only write that round. */
  round: z.number().int().min(1),
  /** Set when an admin enqueued it while impersonating; the attempt event carries it. */
  impersonatedBy: z.string().min(1).optional(),
});

export type ReceiptExtractPayload = z.infer<typeof receiptExtractPayload>;

/** The job for one round. Its key makes a replayed upload or double-clicked retry a no-op. */
export const receiptExtractJob = (payload: ReceiptExtractPayload, priority: number): NewJob => ({
  kind: RECEIPT_EXTRACT,
  payload,
  priority,
  maxAttempts: RECEIPT_EXTRACT_MAX_ATTEMPTS,
  idempotencyKey: `receipt:${payload.receiptId}:round:${payload.round}`,
  receiptId: payload.receiptId,
  organizationId: payload.organizationId,
  userId: payload.userId,
});
