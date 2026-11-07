import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  NoSuchModelError,
  NoSuchProviderError,
  RetryError,
  TypeValidationError,
} from "ai";
import type { ExtractionUsage } from "./models";

/**
 * Why one extraction call failed. The caller decides from this whether
 * another model is worth trying: a slow or overloaded provider is, a photo
 * the model can't read usually isn't.
 */
export const OCR_FAILURE_KINDS = [
  "timeout",
  "rate-limited",
  "provider-error",
  "invalid-output",
  "bad-image",
  "not-configured",
  /** The model declined (Claude's refusal, Gemini's safety stop). Another model may not. */
  "refused",
  /** This model can't take this file (type or size); another model may. */
  "unsupported-file",
] as const;
export type OcrFailureKind = (typeof OCR_FAILURE_KINDS)[number];

function fromStatus(status: number): OcrFailureKind {
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "provider-error";
  // Bad or revoked key, billing (Anthropic's 402), or a model id the provider doesn't know.
  if (status === 401 || status === 402 || status === 403 || status === 404) return "not-configured";
  // Too large for this provider; another may take it.
  if (status === 413) return "unsupported-file";
  // 400, 422: the provider refused the input itself.
  return "bad-image";
}

/** The cause of a step skipped before any request: this model can't take the file's type or size. */
export class UnsupportedFileError extends Error {
  override name = "UnsupportedFileError";
}

/**
 * Every failed extraction call: why, and the tokens it used when the provider
 * reported them. The message is the kind (plus an HTTP status) only: the SDK's
 * own messages can embed the model's output, i.e. receipt contents. `cause`
 * keeps the original for debugging; never log its message.
 */
export class OcrCallError extends Error {
  override name = "OcrCallError";
  constructor(
    readonly kind: OcrFailureKind,
    readonly usage: ExtractionUsage | null,
    // Not a parameter property: Error's own `cause` is non-enumerable, so serializers skip it.
    cause: unknown,
  ) {
    const status = statusOf(cause);
    super(`OCR call failed: ${kind}${status === undefined ? "" : ` (HTTP ${status})`}`, { cause });
    this.skipped = cause instanceof UnsupportedFileError;
  }

  /** No request was sent: nothing billed, no provider latency. */
  readonly skipped: boolean;
}

function statusOf(error: unknown): number | undefined {
  if (RetryError.isInstance(error)) return statusOf(error.lastError);
  return APICallError.isInstance(error) ? error.statusCode : undefined;
}

/**
 * How long the provider asked us to wait (`Retry-After`, seconds or an HTTP
 * date), in ms; undefined when it didn't say. Read from the wrapped SDK error.
 */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  if (error instanceof OcrCallError) return retryAfterMs(error.cause, now);
  if (RetryError.isInstance(error)) return retryAfterMs(error.lastError, now);
  if (!APICallError.isInstance(error)) return undefined;
  const headers = error.responseHeaders ?? {};
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export function classifyOcrError(error: unknown): OcrFailureKind {
  if (error instanceof OcrCallError) return error.kind;
  // With retries, the SDK wraps the last attempt's error.
  if (RetryError.isInstance(error)) return classifyOcrError(error.lastError);
  if (APICallError.isInstance(error)) {
    return error.statusCode === undefined ? "provider-error" : fromStatus(error.statusCode);
  }
  // A refusal with prose (or no) text fails parsing before the caller sees the finish reason.
  if (NoObjectGeneratedError.isInstance(error) && error.finishReason === "content-filter") {
    return "refused";
  }
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  ) {
    return "invalid-output";
  }
  if (
    LoadAPIKeyError.isInstance(error) ||
    NoSuchModelError.isInstance(error) ||
    NoSuchProviderError.isInstance(error)
  ) {
    return "not-configured";
  }
  // AbortSignal.timeout() and the SDK's own timeout both reject with a TimeoutError;
  // an AbortError here means the caller's deadline cut the call short.
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  // Network failures (fetch TypeError, socket resets), the fixture's simulated
  // outage (FIXTURE_FAIL), and anything unrecognised.
  return "provider-error";
}
