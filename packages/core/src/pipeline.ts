import { receiptObjectKey } from "@receipt-ocr/storage";
import { Duration, Effect } from "effect";
import { Conflict, NotFound, StorageError } from "./errors";
import { sniffMediaType, validateUpload } from "./files";
import {
  MAX_EXTRACTION_ATTEMPTS,
  EXTRACTION_FAILED_MESSAGE,
  ReceiptRepo,
  type ReceiptScope,
} from "./repository";
import { Ocr } from "./ocr";
import { Storage } from "./services";

export type StepTiming = { step: string; ms: number };

/**
 * Records a step's duration. Timings go back to the caller so the request
 * emits one wide event instead of scattered per-step logs.
 */
const timed = <A, E, R>(timings: StepTiming[], step: string, effect: Effect.Effect<A, E, R>) =>
  Effect.timed(effect).pipe(
    Effect.map(([duration, value]) => {
      timings.push({ step, ms: Math.round(Duration.toMillis(duration)) });
      return value;
    }),
  );

/** Stage 1, always synchronous: validate the file, store it, create the row. */
export const ingestUpload = (input: { scope: ReceiptScope; fileName: string; body: Uint8Array }) =>
  Effect.gen(function* () {
    const mediaType = yield* validateUpload(input.body);
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const timings: StepTiming[] = [];

    const id = crypto.randomUUID();
    const imageObjectKey = receiptObjectKey(input.scope.userId, id, mediaType);
    yield* timed(timings, "storage.put", storage.put(imageObjectKey, input.body, mediaType));
    const receipt = yield* timed(
      timings,
      "db.insert",
      repo.insert({
        id,
        scope: input.scope,
        fileName: input.fileName.slice(0, 200),
        imageObjectKey,
      }),
    ).pipe(
      // No row means nothing would ever delete the object.
      Effect.tapError(() => storage.remove([imageObjectKey]).pipe(Effect.ignore)),
    );
    return { receipt, timings };
  });

/**
 * Stage 2: load the receipt and its stored file by id, run OCR and persist the
 * result. Nothing about the receipt comes from the caller, so a queue worker
 * can call this with an id. The result is written only if this is still the
 * current attempt. Any failure marks the receipt failed (retryable) with a
 * message fit for the UI; the cause stays in the typed error for logs.
 */
export const extractStored = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const ocr = yield* Ocr;
    const timings: StepTiming[] = [];

    const row = yield* repo.get(input.receiptId, input.scope);
    if (!row) return yield* new NotFound({ message: "Receipt not found" });
    if (row.status !== "processing") {
      return yield* new Conflict({ message: "Only a receipt being processed can be extracted" });
    }
    const attempt = row.attempts;
    const key = row.imageObjectKey;

    return yield* Effect.gen(function* () {
      if (!key) return yield* new StorageError({ message: "This receipt has no stored file" });
      const data = yield* timed(timings, "storage.get", storage.get(key));
      const mediaType = sniffMediaType(data);
      if (!mediaType) {
        return yield* new StorageError({ message: "The stored file is not a supported type" });
      }
      const result = yield* timed(timings, "ai.extract", ocr.extract({ data, mediaType }));
      const receipt = yield* timed(
        timings,
        "db.complete",
        repo.complete(input.receiptId, input.scope, attempt, result.extraction, result.model),
      );
      if (!receipt) {
        return yield* new NotFound({
          message: "Receipt was deleted or superseded during extraction",
        });
      }
      return {
        receipt,
        usage: result.usage,
        model: result.model,
        attempts: result.attempts,
        timings,
      };
    }).pipe(Effect.tapError(() => markFailed(input.receiptId, input.scope, attempt)));
  });

const markFailed = (receiptId: string, scope: ReceiptScope, attempt: number) =>
  Effect.flatMap(ReceiptRepo, (repo) =>
    repo.fail(receiptId, scope, attempt, EXTRACTION_FAILED_MESSAGE),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.logError("receipt.fail_not_recorded", { receiptId, error: error.message }),
    ),
  );

/**
 * Atomically moves a failed receipt back to `processing` under a new attempt.
 * The caller then runs `extractStored` (in the background).
 */
export const claimRetry = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const claim = yield* repo.claimRetry(input.receiptId, input.scope);
    if (claim.kind === "not-found") return yield* new NotFound({ message: "Receipt not found" });
    if (claim.kind === "not-retryable") {
      return yield* new Conflict({ message: "Only receipts that failed can be retried" });
    }
    if (claim.kind === "attempts-exhausted") {
      return yield* new Conflict({
        message: `This receipt was tried ${MAX_EXTRACTION_ATTEMPTS} times. Upload a clearer photo instead.`,
      });
    }
  });

/** Deletes the row, then its stored file. */
export const deleteReceipt = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const removed = yield* repo.remove(input.receiptId, input.scope);
    if (!removed) return yield* new NotFound({ message: "Receipt not found" });
    if (removed.imageObjectKey) {
      // The row is already gone; a leftover object is logged with its key for a sweep.
      yield* storage.remove([removed.imageObjectKey]).pipe(
        Effect.catchAll((error) =>
          Effect.logError("receipt.object_delete_failed", {
            key: removed.imageObjectKey,
            error: error.message,
          }),
        ),
      );
    }
  });

/** Deletes every stored file of a workspace or user, before their rows cascade away. */
export const purgeReceiptFiles = (owner: { organizationId: string } | { userId: string }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const keys = yield* repo.objectKeys(owner);
    yield* storage.remove(keys);
    return keys.length;
  });

/** Loads a receipt with a short-lived image URL; signing failures still return the data. */
export const getReceiptWithImage = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const receipt = yield* repo.get(input.receiptId, input.scope);
    if (!receipt?.imageObjectKey) return receipt;
    const imageUrl = yield* storage.signedUrl(receipt.imageObjectKey).pipe(Effect.option);
    return imageUrl._tag === "Some" ? { ...receipt, imageUrl: imageUrl.value } : receipt;
  });
