import { Effect } from "effect";
import { Storage } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import { NonRetryableJobError, RetryableJobError, type JobDefinition } from "../definition";
import {
  STORAGE_DELETE,
  storageDeletePayload,
  type StorageDeletePayload,
} from "../storage-delete-job";

/**
 * Deletes the files. A key that is already gone counts as deleted (S3 DeleteObjects), so a
 * retry after a partial run is safe. Storage not configured is dead at once; anything else
 * retries with backoff, and a job that dies shows in the admin jobs list with its keys.
 */
export const storageDelete: JobDefinition<StorageDeletePayload, Storage> = {
  kind: STORAGE_DELETE,
  payload: storageDeletePayload,
  maxAttempts: 8,
  leaseSeconds: 60,
  backoff: { baseMs: 30_000, capMs: 60 * 60_000 },

  run: (payload) =>
    Effect.flatMap(Storage, (storage) => storage.remove(payload.keys)).pipe(
      Effect.tap(() => annotateEvent({ count: payload.keys.length })),
      Effect.as({ deleted: payload.keys.length }),
      Effect.tapError((error) => annotateEvent({ error: errorFields(error) })),
      Effect.mapError((error) =>
        error._tag === "NotConfigured"
          ? new NonRetryableJobError({ kind: "storage-off" })
          : new RetryableJobError({ kind: "storage-error" }),
      ),
    ),
};
