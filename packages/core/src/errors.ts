import type { ExtractionUsage, OcrFailureKind } from "@receipt-ocr/ai";
import { Data } from "effect";

/** Bad input from the caller: wrong file type, too large, malformed fields. */
export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly message: string;
}> {}

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string;
}> {}

/** The caller is in the workspace but their role doesn't allow this action. */
export class Forbidden extends Data.TaggedError("Forbidden")<{
  readonly message: string;
}> {}

/** The receipt is not in a state that allows the action (e.g. retrying a completed one). */
export class Conflict extends Data.TaggedError("Conflict")<{
  readonly message: string;
}> {}

export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  readonly message: string;
  readonly retryAfterSeconds: number;
  /**
   * The limit hit (`error.kind` on the wide event): the per-minute burst, the day, the month,
   * the plan's platform pool, or the service cap.
   */
  readonly kind?: "minute" | "day" | "month" | "pool" | "global";
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

/** The billing provider's API failed or answered with something we can't read. */
export class BillingProviderError extends Data.TaggedError("BillingProviderError")<{
  readonly message: string;
  /** Why the provider call failed, safe to log: `http-<status>`, `bad-response`, `network` or `timeout`. */
  readonly kind?: string;
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
  /** Skipped before any request (the model can't take this file): free, and not a model call. */
  skipped?: true;
};

export class OcrError extends Data.TaggedError("OcrError")<{
  readonly message: string;
  /** Why the last model tried failed. */
  readonly kind: OcrFailureKind;
  readonly attempts: readonly OcrAttempt[];
  readonly cause?: unknown;
  /** Steps were left out for a provider cooling down after a 429; the earliest that one ends. */
  readonly coolingUntil?: Date;
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
  | Forbidden
  | Conflict
  | QuotaExceeded
  | NotConfigured
  | DbError
  | StorageError
  | BillingProviderError
  | OcrError;
