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

/** Words in a Google 400 that blame the input file rather than the request's own parameters. */
const IMAGE_COMPLAINT = /image|mime|media type|document|pdf|inline_?data|\bfile\b|corrupt|decode/i;

/**
 * A Google 400 with status INVALID_ARGUMENT whose message doesn't blame the file: the request
 * itself (a schema keyword, a generation setting) was rejected, so the photo is not at fault.
 * Gemini sends these with no detail, e.g. "Request contains an invalid argument."
 */
function isRequestRejection(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isRequestRejection(error.lastError);
  if (!APICallError.isInstance(error) || error.statusCode !== 400 || !error.responseBody) {
    return false;
  }
  try {
    const body = (
      JSON.parse(error.responseBody) as { error?: { status?: unknown; message?: unknown } }
    ).error;
    return body?.status === "INVALID_ARGUMENT" && !IMAGE_COMPLAINT.test(String(body.message ?? ""));
  } catch {
    return false;
  }
}

/** Groq's error body: `{ error: { message, type, code } }`. Only these fields are read. */
function groqErrorOf(error: APICallError): { code: string; message: string } | null {
  if (!error.url.startsWith("https://api.groq.com/")) return null;
  try {
    const body = (
      JSON.parse(error.responseBody ?? "") as { error?: { code?: unknown; message?: unknown } }
    ).error;
    return { code: String(body?.code ?? ""), message: String(body?.message ?? "") };
  } catch {
    return { code: "", message: "" };
  }
}

/**
 * Groq answers 400 for more than a bad image. By its `code`: best-effort output that broke the
 * schema is `invalid-output`; a retired model, or a request rejected for a reason that doesn't
 * blame the file (an unsupported schema keyword), is `not-configured`, so the chain moves on.
 */
function classifyGroq400(error: APICallError): OcrFailureKind | null {
  const body = groqErrorOf(error);
  if (!body || error.statusCode !== 400) return null;
  if (body.code === "json_validate_failed") return "invalid-output";
  if (body.code === "model_decommissioned" || body.code === "model_not_found") {
    return "not-configured";
  }
  return IMAGE_COMPLAINT.test(body.message) ? null : "not-configured";
}

/** OpenAI's error body: `{ error: { message, type, param, code } }`. Only these fields are read. */
function openaiErrorOf(error: APICallError): { code: string; message: string } | null {
  if (!error.url.startsWith("https://api.openai.com/")) return null;
  try {
    const body = (
      JSON.parse(error.responseBody ?? "") as { error?: { code?: unknown; message?: unknown } }
    ).error;
    return { code: String(body?.code ?? ""), message: String(body?.message ?? "") };
  } catch {
    return { code: "", message: "" };
  }
}

/** 429 codes for an exhausted balance or spend cap: waiting does not help, an admin must act. */
const OPENAI_QUOTA_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

/**
 * OpenAI's 400s and 429s, by `code` and then message. A spent balance is `not-configured` (the
 * chain moves on and nothing retries until an admin adds credit); a prompt over the model's
 * context is `unsupported-file`; a rejected request that doesn't blame the file (a schema
 * keyword, an effort value the model lacks) is `not-configured`. Other 429s are rate limits.
 */
function classifyOpenai(error: APICallError): OcrFailureKind | null {
  const body = openaiErrorOf(error);
  if (!body) return null;
  if (error.statusCode === 429) {
    return OPENAI_QUOTA_CODES.has(body.code) ? "not-configured" : null;
  }
  if (error.statusCode !== 400) return null;
  if (body.code === "context_length_exceeded") return "unsupported-file";
  if (body.code === "model_not_found") return "not-configured";
  return IMAGE_COMPLAINT.test(body.message) ? null : "not-configured";
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
    const why = isRequestRejection(cause) ? ", invalid request" : "";
    super(`OCR call failed: ${kind}${status === undefined ? "" : ` (HTTP ${status}${why})`}`, {
      cause,
    });
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
  if (!value) return retryDelayInBody(error.responseBody);
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Gemini puts its hint in the 429 body, not a header: a google.rpc.RetryInfo
 * detail with `retryDelay` like "17s" or "1.5s". Only that field is read.
 */
function retryDelayInBody(body: string | undefined): number | undefined {
  if (!body) return undefined;
  try {
    const details = (JSON.parse(body) as { error?: { details?: unknown } }).error?.details;
    if (!Array.isArray(details)) return undefined;
    for (const detail of details as Array<Record<string, unknown>>) {
      if (!String(detail["@type"] ?? "").endsWith("google.rpc.RetryInfo")) continue;
      const match = /^(\d+(?:\.\d+)?)s$/.exec(String(detail.retryDelay ?? ""));
      if (match) return Math.round(Number(match[1]) * 1000);
    }
  } catch {
    // Not JSON: no hint.
  }
  return undefined;
}

export function classifyOcrError(error: unknown): OcrFailureKind {
  if (error instanceof OcrCallError) return error.kind;
  // With retries, the SDK wraps the last attempt's error.
  if (RetryError.isInstance(error)) return classifyOcrError(error.lastError);
  if (APICallError.isInstance(error)) {
    // Our request is wrong for this model, not the photo: configuration, and the next model may work.
    if (isRequestRejection(error)) return "not-configured";
    const groq = classifyGroq400(error);
    if (groq) return groq;
    const openai = classifyOpenai(error);
    if (openai) return openai;
    // A 2xx the SDK could not parse (OpenAI's Responses schema has no refusal content part, so a
    // refusal lands here): the input was accepted, so it is the reply that is unusable.
    if (error.statusCode !== undefined && error.statusCode >= 200 && error.statusCode < 300) {
      return "invalid-output";
    }
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
