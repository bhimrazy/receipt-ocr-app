import { costOf, type ModelId } from "@receipt-ocr/ai";
import { receiptObjectKey } from "@receipt-ocr/storage";
import { Duration, Effect } from "effect";
import {
  Conflict,
  InvalidInput,
  NotFound,
  type DbError,
  type NotConfigured,
  type OcrAttempt,
  type OcrError,
  type ProvidersCooling,
  type StorageError,
} from "./errors";
import { sniffMediaType, validateUpload } from "./files";
import {
  MAX_EXTRACTION_ATTEMPTS,
  EXTRACTION_FAILED_MESSAGE,
  ReceiptRepo,
  type OcrCallRow,
  type ReceiptScope,
} from "./repository";
import { Ocr, providerOf, type ProviderCooldowns } from "./ocr";
import { quotaExceeded, quotaGate, type QuotaLimits } from "./quota";
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

type CallContext = {
  receiptId: string;
  scope: ReceiptScope;
  round: number;
  jobAttempt: number;
  at: Date;
};

/** One `ocr_calls` row per model call, priced now; the price is never recomputed later. */
export function ocrCallRows(attempts: readonly OcrAttempt[], context: CallContext): OcrCallRow[] {
  return attempts.map((attempt) => {
    const cost = costOf(attempt.model, attempt.usage, context.at);
    return {
      receiptId: context.receiptId,
      organizationId: context.scope.organizationId,
      userId: context.scope.userId,
      round: context.round,
      jobAttempt: context.jobAttempt,
      step: attempt.step,
      model: attempt.model,
      provider: providerOf(attempt.model as ModelId),
      status: attempt.kind,
      latencyMs: Math.round(attempt.ms),
      inputTokens: attempt.usage?.inputTokens ?? null,
      cachedInputTokens: attempt.usage?.cachedInputTokens ?? null,
      cacheWriteTokens: attempt.usage?.cacheWriteTokens ?? null,
      outputTokens: attempt.usage?.outputTokens ?? null,
      reasoningTokens: attempt.usage?.reasoningTokens ?? null,
      costMicroUsd: cost.microUsd,
      priceFrom: cost.priceFrom,
      createdAt: context.at,
    };
  });
}

/**
 * The one row for a round that failed before any model was called (no stored
 * file, nothing configured), so it stops reading as in flight. It cost nothing.
 */
export function noCallRow(status: OcrCallRow["status"], context: CallContext): OcrCallRow {
  return {
    receiptId: context.receiptId,
    organizationId: context.scope.organizationId,
    userId: context.scope.userId,
    round: context.round,
    jobAttempt: context.jobAttempt,
    step: 0,
    model: null,
    provider: null,
    status,
    latencyMs: 0,
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    costMicroUsd: 0,
    priceFrom: null,
    createdAt: context.at,
  };
}

/** Total of the known costs; null when no call has one. */
const totalCost = (rows: readonly OcrCallRow[]) =>
  rows.reduce<number | null>(
    (sum, row) => (row.costMicroUsd == null ? sum : (sum ?? 0) + row.costMicroUsd),
    null,
  );

/**
 * Stage 1, always synchronous: validate the file, store it, create the row
 * and enqueue its extraction job. The quota is checked again where the row is
 * created, under the user's lock: a parallel burst can't all pass an earlier
 * check.
 */
export const ingestUpload = (input: {
  scope: ReceiptScope;
  fileName: string;
  body: Uint8Array;
  limits: QuotaLimits;
  /** Priority of its extraction job; interactive by default. */
  priority?: number;
}) =>
  Effect.gen(function* () {
    const mediaType = yield* validateUpload(input.body);
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const timings: StepTiming[] = [];

    const id = crypto.randomUUID();
    const imageObjectKey = receiptObjectKey(input.scope.userId, id, mediaType);
    yield* timed(timings, "storage.put", storage.put(imageObjectKey, input.body, mediaType));
    const gate = yield* quotaGate(input.limits);
    const inserted = yield* timed(
      timings,
      "db.insert",
      repo.insert(
        {
          id,
          scope: input.scope,
          fileName: input.fileName.slice(0, 200),
          imageObjectKey,
          priority: input.priority,
        },
        gate,
      ),
    ).pipe(
      Effect.flatMap((result) =>
        result.kind === "inserted"
          ? Effect.succeed(result)
          : Effect.fail(quotaExceeded(result.verdict)),
      ),
      // No row means nothing would ever delete the object.
      Effect.tapError(() => storage.remove([imageObjectKey]).pipe(Effect.ignore)),
    );
    return { receipt: inserted.receipt, jobId: inserted.jobId, timings };
  });

export type ExtractionInput = {
  receiptId: string;
  scope: ReceiptScope;
  /** The round the job was enqueued for: only that round may be written. */
  round: number;
  /** Which automatic attempt of the round's job this is (1-based). */
  jobAttempt: number;
  /** Providers cooling down after a 429; their models are skipped. */
  cooling?: ProviderCooldowns;
};

/** A run that had nothing to do: the receipt is gone, or a newer round or a final state replaced this one. */
export type ExtractionSkipped = { kind: "skipped"; reason: "not-found" | "superseded" };

/** Why an attempt failed. The job decides from the error whether it retries. */
export type ExtractionError =
  OcrError | NotConfigured | ProvidersCooling | StorageError | InvalidInput | DbError;

/**
 * Stage 2, one attempt of a round: load the receipt and its stored file by
 * id, run OCR and persist the result. Nothing about the receipt comes from
 * the caller, so any worker can run it from a job payload. The result is
 * written only if this round is still the current one (the fencing token).
 *
 * A failure does not settle the receipt: its calls are recorded (every
 * attempt is billed) and the error goes back to the job, which retries it
 * or, once it is dead, calls `settleFailure`.
 */
export const runExtraction = (input: ExtractionInput) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const storage = yield* Storage;
    const ocr = yield* Ocr;
    const timings: StepTiming[] = [];

    const row = yield* repo.get(input.receiptId, input.scope);
    if (!row) return { kind: "skipped", reason: "not-found" } satisfies ExtractionSkipped;
    if (row.status !== "processing" || row.attempts !== input.round) {
      return { kind: "skipped", reason: "superseded" } satisfies ExtractionSkipped;
    }
    const key = row.imageObjectKey;
    // Calls made so far. Written with whichever outcome is recorded, so every
    // call is billed and counted even when the receipt is gone or superseded.
    let calls: OcrCallRow[] = [];
    let recorded = false;
    const context = () => ({
      receiptId: input.receiptId,
      scope: input.scope,
      round: input.round,
      jobAttempt: input.jobAttempt,
      at: new Date(),
    });
    const rowsFor = (attempts: readonly OcrAttempt[]) => ocrCallRows(attempts, context());
    /** What the failure path writes: the calls made, or one row saying none was. */
    const failedCalls = (error: ExtractionError): OcrCallRow[] => {
      if (recorded) return [];
      if (calls.length > 0) return calls;
      switch (error._tag) {
        case "OcrError":
          return [noCallRow(error.kind, context())];
        case "NotConfigured":
          return [noCallRow("not-configured", context())];
        case "StorageError":
        case "InvalidInput":
          return [noCallRow("storage-error", context())];
        // Nothing was attempted (cooling), or the database itself failed.
        case "ProvidersCooling":
        case "DbError":
          return [];
      }
    };

    return yield* Effect.gen(function* () {
      if (!key) return yield* new InvalidInput({ message: "This receipt has no stored file" });
      const data = yield* timed(timings, "storage.get", storage.get(key));
      const mediaType = sniffMediaType(data);
      if (!mediaType) {
        return yield* new InvalidInput({ message: "The stored file is not a supported type" });
      }
      const result = yield* timed(
        timings,
        "ai.extract",
        ocr.extract({ data, mediaType }, { cooling: input.cooling }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (error._tag === "OcrError") calls = rowsFor(error.attempts);
            }),
          ),
        ),
      );
      const written = rowsFor(result.attempts);
      calls = written;
      const receipt = yield* timed(
        timings,
        "db.complete",
        repo.complete(
          input.receiptId,
          input.scope,
          input.round,
          result.extraction,
          result.model,
          written,
        ),
      );
      // Written with the completion; the failure path must not write them again.
      recorded = true;
      if (!receipt) {
        // Deleted or superseded while the model ran.
        return { kind: "skipped", reason: "superseded" } satisfies ExtractionSkipped;
      }
      return {
        kind: "completed" as const,
        receipt,
        usage: result.usage,
        model: result.model,
        attempts: result.attempts,
        costMicroUsd: totalCost(written),
        timings,
      };
    }).pipe(
      Effect.tapError((error) => {
        const rows = failedCalls(error);
        return rows.length === 0
          ? Effect.void
          : repo.recordCalls(rows).pipe(
              Effect.catchAll((dbError) =>
                Effect.logError("receipt.calls_not_recorded", {
                  receiptId: input.receiptId,
                  unrecordedCalls: rows.length,
                  error: dbError.message,
                }),
              ),
            );
      }),
    );
  });

/**
 * Settles a round that won't be read: the receipt becomes failed (the user
 * can retry) with a message fit for the UI. Only the round's own job may do
 * this, and only once it is dead or cancelled. Never fails; a lost write is
 * logged and the receipt later reads as failed through the stale rule.
 */
export const settleFailure = (input: {
  receiptId: string;
  scope: ReceiptScope;
  round: number;
  message?: string;
  calls?: readonly OcrCallRow[];
}) =>
  Effect.flatMap(ReceiptRepo, (repo) =>
    repo.fail(
      input.receiptId,
      input.scope,
      input.round,
      input.message ?? EXTRACTION_FAILED_MESSAGE,
      input.calls ?? [],
    ),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.logError("receipt.fail_not_recorded", {
        receiptId: input.receiptId,
        error: error.message,
      }).pipe(Effect.as(false)),
    ),
  );

/**
 * Atomically moves a failed receipt back to `processing` under a new round
 * and enqueues its job. The caller then gets the job run (in the background).
 */
export const claimRetry = (input: {
  receiptId: string;
  scope: ReceiptScope;
  limits: QuotaLimits;
}) =>
  Effect.gen(function* () {
    const repo = yield* ReceiptRepo;
    const claim = yield* repo.claimRetry(
      input.receiptId,
      input.scope,
      yield* quotaGate(input.limits),
    );
    if (claim.kind === "quota") return yield* quotaExceeded(claim.verdict);
    if (claim.kind === "not-found") return yield* new NotFound({ message: "Receipt not found" });
    if (claim.kind === "not-retryable") {
      return yield* new Conflict({ message: "Only receipts that failed can be retried" });
    }
    if (claim.kind === "attempts-exhausted") {
      return yield* new Conflict({
        message: `This receipt was tried ${MAX_EXTRACTION_ATTEMPTS} times. Upload a clearer photo instead.`,
      });
    }
    return { round: claim.round, jobId: claim.jobId };
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
