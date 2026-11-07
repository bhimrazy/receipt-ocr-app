import type { ModelId, OcrFailureKind } from "@receipt-ocr/ai";
import { Effect } from "effect";
import type { OcrAttempt } from "../../errors";
import { providerOf, type Ocr, type ProviderCooldowns } from "../../ocr";
import { noCallRow, runExtraction, settleFailure, type ExtractionError } from "../../pipeline";
import type { ReceiptRepo } from "../../repository";
import type { Storage } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { errorFields } from "../../telemetry/redact";
import {
  JobDeferred,
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type JobFailure,
} from "../definition";
import { JobQueue } from "../queue";
import {
  RECEIPT_EXTRACT,
  RECEIPT_EXTRACT_MAX_ATTEMPTS,
  receiptExtractPayload,
  type ReceiptExtractPayload,
} from "../receipt-extract-job";

/** Shown on a receipt whose job an admin cancelled. */
export const EXTRACTION_CANCELLED_MESSAGE = "Reading this receipt was stopped. Try again.";

/** Worth another attempt: the provider was slow, busy or down. The rest won't change on a retry. */
const RETRYABLE_OCR: ReadonlySet<OcrFailureKind> = new Set([
  "timeout",
  "rate-limited",
  "provider-error",
]);

/** A 429 with no Retry-After still cools its provider down this long. */
const DEFAULT_COOLDOWN_MS = 30_000;
/** However long a provider asks for, other jobs try again after at most this. */
const MAX_COOLDOWN_MS = 10 * 60_000;

/**
 * Maps a failed attempt to the job's next step:
 * - retry: timeout, rate-limited, provider-error, storage and database errors;
 * - dead now: invalid-output, bad-image, not-configured (an admin re-runs it
 *   once keys are fixed), and an unreadable stored file;
 * - deferred, without spending an attempt: every provider is cooling down.
 */
export function classifyExtractionError(error: ExtractionError): JobFailure {
  switch (error._tag) {
    case "OcrError": {
      if (!RETRYABLE_OCR.has(error.kind)) return new NonRetryableJobError({ kind: error.kind });
      const waits = error.attempts.flatMap((a) =>
        a.retryAfterMs === undefined ? [] : [a.retryAfterMs],
      );
      return new RetryableJobError({
        kind: error.kind,
        ...(waits.length > 0 ? { retryAfterMs: Math.max(...waits) } : {}),
      });
    }
    case "NotConfigured":
      return new NonRetryableJobError({ kind: "not-configured" });
    case "InvalidInput":
      return new NonRetryableJobError({ kind: "stored-file-invalid" });
    case "StorageError":
      return new RetryableJobError({ kind: "storage-error" });
    case "DbError":
      return new RetryableJobError({ kind: "db-error" });
    case "ProvidersCooling":
      return new JobDeferred({ kind: "providers-cooling", until: error.until });
  }
}

/** Providers that answered 429, and how long (ms) to leave each alone. */
export function cooldownsFrom(error: ExtractionError): Map<string, number> {
  const cooling = new Map<string, number>();
  if (error._tag !== "OcrError") return cooling;
  for (const attempt of error.attempts) {
    if (attempt.kind !== "rate-limited") continue;
    const ms = Math.min(attempt.retryAfterMs ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS);
    const provider = providerOf(attempt.model as ModelId);
    cooling.set(provider, Math.max(cooling.get(provider) ?? 0, ms));
  }
  return cooling;
}

const scopeOf = (payload: ReceiptExtractPayload) => ({
  organizationId: payload.organizationId,
  userId: payload.userId,
});

/** What the run reports back for the caller's wide event (never receipt contents). */
export type ReceiptExtractResult =
  | { kind: "skipped"; reason: "not-found" | "superseded" }
  | {
      kind: "completed";
      receiptId: string;
      model: string;
      attempts: readonly OcrAttempt[];
      costMicroUsd: number | null;
      confidence: string | null;
      itemsCount: number;
    };

export const receiptExtract: JobDefinition<
  ReceiptExtractPayload,
  ReceiptRepo | Storage | Ocr | JobQueue
> = {
  kind: RECEIPT_EXTRACT,
  payload: receiptExtractPayload,
  maxAttempts: RECEIPT_EXTRACT_MAX_ATTEMPTS,
  // The OCR chain's 50 s deadline plus storage and the write.
  leaseSeconds: 90,
  backoff: { baseMs: 10_000, capMs: 10 * 60_000 },

  run: (payload, { attempt }) =>
    Effect.gen(function* () {
      const queue = yield* JobQueue;
      yield* annotateEvent({ round: payload.round });
      // Unknown cooldowns (database blip) mean "try every provider", not a failed attempt.
      const cooling = (yield* queue.cooldowns.pipe(
        Effect.orElseSucceed(() => new Map()),
      )) as ProviderCooldowns;
      if (cooling.size > 0) yield* annotateEvent({ flags: { providers_cooling: cooling.size } });
      const outcome = yield* runExtraction({
        receiptId: payload.receiptId,
        scope: scopeOf(payload),
        round: payload.round,
        jobAttempt: attempt,
        cooling,
      }).pipe(
        Effect.tapError((error) =>
          Effect.zipRight(
            annotateEvent({ error: errorFields(error) }),
            Effect.forEach(cooldownsFrom(error), ([provider, ms]) =>
              queue.coolDown(provider, ms).pipe(Effect.ignore),
            ),
          ),
        ),
        Effect.mapError(classifyExtractionError),
      );
      if (outcome.kind === "skipped") {
        yield* annotateEvent({ queue: { skipped: outcome.reason } });
        return outcome satisfies ReceiptExtractResult;
      }
      return {
        kind: "completed",
        receiptId: payload.receiptId,
        model: outcome.model,
        attempts: outcome.attempts,
        costMicroUsd: outcome.costMicroUsd,
        confidence: outcome.receipt.confidence,
        itemsCount: outcome.receipt.items.length,
      } satisfies ReceiptExtractResult;
    }),

  onFinalFailure: (payload, { job, errorKind }) =>
    settleFailure({
      receiptId: payload.receiptId,
      scope: scopeOf(payload),
      round: payload.round,
      ...(errorKind === "cancelled" ? { message: EXTRACTION_CANCELLED_MESSAGE } : {}),
      // A worker that died mid-call wrote nothing for this attempt; one row
      // says it ended, so the round stops reading as in flight.
      calls:
        errorKind === "lease-expired"
          ? [
              noCallRow("timeout", {
                receiptId: payload.receiptId,
                scope: scopeOf(payload),
                round: payload.round,
                jobAttempt: job.attempts,
                at: new Date(),
              }),
            ]
          : [],
    }).pipe(Effect.asVoid),
};
