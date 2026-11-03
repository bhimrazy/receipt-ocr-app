import { receiptObjectKey } from "@receipt-ocr/storage";
import { Duration, Effect } from "effect";
import { Conflict, NotFound, StorageError } from "./errors";
import { sniffMediaType, validateUpload } from "./files";
import { EXTRACTION_FAILED_MESSAGE, ReceiptRepo, type ReceiptScope } from "./repository";
import { Ocr, Storage } from "./services";

export type StepTiming = { step: string; ms: number };

export type StoredFile = { data: Uint8Array; mediaType: string };

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
    return { receipt, file: { data: input.body, mediaType } satisfies StoredFile, timings };
  });

/**
 * Stage 2: run OCR and persist the result. Any failure marks the receipt
 * failed (retryable) with a message fit for the UI; the cause stays in the
 * typed error for logs.
 */
export const extractStored = (input: {
  receiptId: string;
  scope: ReceiptScope;
  file: StoredFile;
}) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const ocr = yield* Ocr;
    const timings: StepTiming[] = [];
    const result = yield* timed(timings, "ai.extract", ocr.extract(input.file));
    const receipt = yield* timed(
      timings,
      "db.complete",
      repo.complete(input.receiptId, input.scope, result.extraction),
    );
    if (!receipt) return yield* new NotFound({ message: "Receipt was deleted during extraction" });
    return { receipt, usage: result.usage, model: result.model, timings };
  }).pipe(Effect.tapError(() => markFailed(input.receiptId, input.scope)));

const markFailed = (receiptId: string, scope: ReceiptScope) =>
  Effect.flatMap(ReceiptRepo, (repo) =>
    repo.fail(receiptId, scope, EXTRACTION_FAILED_MESSAGE),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.logError("receipt.fail_not_recorded", { receiptId, error: error.message }),
    ),
  );

/**
 * Claims a failed receipt for another extraction and loads its stored file.
 * The caller runs `extractStored` with the result (in the background).
 */
export const claimRetry = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const claim = yield* repo.claimRetry(input.receiptId, input.scope);
    if (claim.kind === "not-found") return yield* new NotFound({ message: "Receipt not found" });
    if (claim.kind === "not-retryable") {
      return yield* new Conflict({ message: "Only receipts that failed can be retried" });
    }
    if (!claim.imageObjectKey) {
      return yield* new StorageError({ message: "This receipt has no stored file to retry" });
    }
    const data = yield* storage.get(claim.imageObjectKey);
    const mediaType = sniffMediaType(data);
    if (!mediaType)
      return yield* new StorageError({ message: "The stored file is not a supported type" });
    return { data, mediaType } satisfies StoredFile;
  }).pipe(
    // Claimed but unreadable: put it back to failed rather than leave it processing.
    Effect.tapError((error) =>
      error._tag === "StorageError" || error._tag === "NotConfigured"
        ? markFailed(input.receiptId, input.scope)
        : Effect.void,
    ),
  );

/** Deletes the row, then its stored file. */
export const deleteReceipt = (input: { receiptId: string; scope: ReceiptScope }) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const removed = yield* repo.remove(input.receiptId, input.scope);
    if (!removed) return yield* new NotFound({ message: "Receipt not found" });
    if (removed.imageObjectKey) {
      // The row is already gone; a leftover object is logged with its key for a sweep.
      yield* storage
        .remove([removed.imageObjectKey])
        .pipe(
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
