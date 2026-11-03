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

export class OcrError extends Data.TaggedError("OcrError")<{
  readonly message: string;
  readonly cause?: unknown;
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
