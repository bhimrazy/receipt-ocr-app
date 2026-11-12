import { z } from "zod";
import type { NewJob } from "./definition";

/**
 * Deletes stored files whose rows are already gone. Not a `receipt.%` kind: those are the
 * reads, which the one-live-job-per-receipt index and the stale rule are about.
 */
export const STORAGE_DELETE = "storage.delete";

/** One bulk delete's worth: `MAX_BULK_DELETE` receipts, one file each. */
const MAX_STORAGE_DELETE_KEYS = 1000;

export const storageDeletePayload = z.object({
  keys: z.array(z.string().min(1).max(512)).min(1).max(MAX_STORAGE_DELETE_KEYS),
});

export type StorageDeletePayload = z.infer<typeof storageDeletePayload>;

/** Runs behind receipt reads; the files are already unreachable from the app. */
const PRIORITY_MAINTENANCE = 9;

/**
 * Enqueued in the transaction that deletes the rows, so the files are deleted if and only if
 * the rows are. No owner (`userId`): it must not take one of the user's running slots.
 */
export const storageDeleteJob = (keys: readonly string[], organizationId: string): NewJob => ({
  kind: STORAGE_DELETE,
  payload: { keys: [...keys] } satisfies StorageDeletePayload,
  priority: PRIORITY_MAINTENANCE,
  maxAttempts: 8,
  organizationId,
});
