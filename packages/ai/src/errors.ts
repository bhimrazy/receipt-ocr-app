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

/**
 * Why one extraction call failed. The caller decides from this whether
 * another model is worth trying: a slow or overloaded provider is, a photo
 * the model can't read usually isn't.
 */
export type OcrFailureKind =
  "timeout" | "rate-limited" | "provider-error" | "invalid-output" | "bad-image" | "not-configured";

function fromStatus(status: number): OcrFailureKind {
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "provider-error";
  // Bad or revoked key, or a model id the provider doesn't know.
  if (status === 401 || status === 403 || status === 404) return "not-configured";
  // 400, 413, 422: the provider refused the input itself.
  return "bad-image";
}

export function classifyOcrError(error: unknown): OcrFailureKind {
  // With retries, the SDK wraps the last attempt's error.
  if (RetryError.isInstance(error)) return classifyOcrError(error.lastError);
  if (APICallError.isInstance(error)) {
    return error.statusCode === undefined ? "provider-error" : fromStatus(error.statusCode);
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
