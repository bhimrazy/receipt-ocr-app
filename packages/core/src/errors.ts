import type { ExtractionUsage, OcrFailureKind } from "@receipt-ocr/ai";
import { Data } from "effect";

/** Bad input from the caller: wrong file type, too large, malformed fields. */
export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly message: string;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
}> {}

/** The receipt is not in a state that allows the action (e.g. retrying a completed one). */
export class Conflict extends Data.TaggedError("Conflict")<{
  readonly message: string;
}> {}

export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}> {}

/** A dependency is not configured (missing env), so this feature is off. */
export class NotConfigured extends Data.TaggedError("NotConfigured")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DbError extends Data.TaggedError("DbError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One model call in the OCR chain: logged on the wide event and written to `ocr_calls`. */
export type OcrAttempt = {
  model: string;
  /** Position in the chain: 0 = primary. */
  step: number;
  kind: OcrFailureKind | "ok";
  ms: number;
  /** Null when the provider reported none (timeout, API error). */
  usage: ExtractionUsage | null;
  /** How long a rate-limited provider asked us to wait (its `Retry-After`). */
  retryAfterMs?: number;
};

export class OcrError extends Data.TaggedError("OcrError")<{
  readonly message: string;
  /** Why the last model tried failed. */
  readonly kind: OcrFailureKind;
  readonly attempts: readonly OcrAttempt[];
  readonly cause?: unknown;
}> {}

/** Every model in the chain belongs to a provider that is cooling down after a 429. */
export class ProvidersCooling extends Data.TaggedError("ProvidersCooling")<{
  readonly message: string;
  /** When the first of them may be called again. */
  readonly until: Date;
}> {}

export type AppError =
  | InvalidInput
  | NotFound
  | Conflict
  | QuotaExceeded
  | NotConfigured
  | DbError
  | StorageError
  | OcrError;
