import {
  APICallError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import { describe, expect, it } from "vitest";
import { classifyOcrError, OcrCallError, retryAfterMs } from "../src/errors";
import { extractReceipt } from "../src/extract";
import { FIXTURE_FAIL_MARKER } from "../src/fixture";

const apiError = (statusCode: number | undefined) =>
  new APICallError({
    message: `status ${statusCode}`,
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode,
  });

const googleBody = (status: string, message: string) =>
  JSON.stringify({ error: { code: 400, message, status } }, null, 2);

const apiError400 = (responseBody: string) =>
  new APICallError({
    message: "Request contains an invalid argument.",
    url: "https://generativelanguage.googleapis.com",
    requestBodyValues: {},
    statusCode: 400,
    responseBody,
  });

describe("Google 400 INVALID_ARGUMENT", () => {
  // Recorded 2026-11-07 from gemini-3.5-flash-lite rejecting `maxItems` in responseJsonSchema.
  const recorded = googleBody("INVALID_ARGUMENT", "Request contains an invalid argument.");

  it("a rejected request is a configuration error, so the chain moves on", () => {
    const error = apiError400(recorded);
    expect(classifyOcrError(error)).toBe("not-configured");
    const call = new OcrCallError("not-configured", null, error);
    expect(call.message).toBe("OCR call failed: not-configured (HTTP 400, invalid request)");
  });

  it("looks through the SDK's retry wrapper", () => {
    const retried = new RetryError({
      message: "Failed after 2 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiError400(recorded)],
    });
    expect(classifyOcrError(retried)).toBe("not-configured");
  });

  it.each([
    "Unable to process input image. Please retry or report in https://goo.gle/gemini-feedback",
    "Provided image is not valid.",
    "Unsupported MIME type: image/heic",
    "The document has no pages.",
  ])("a complaint about the file stays bad-image: %s", (message) => {
    expect(classifyOcrError(apiError400(googleBody("INVALID_ARGUMENT", message)))).toBe(
      "bad-image",
    );
  });

  it("other 400s (no Google body, another status string, Anthropic) stay bad-image", () => {
    expect(classifyOcrError(apiError400(""))).toBe("bad-image");
    expect(classifyOcrError(apiError400("<html>"))).toBe("bad-image");
    expect(classifyOcrError(apiError400(googleBody("FAILED_PRECONDITION", "x")))).toBe("bad-image");
    // Not from api.anthropic.com, so the Anthropic branch doesn't apply.
    expect(
      classifyOcrError(
        apiError400(JSON.stringify({ type: "error", error: { type: "invalid_request_error" } })),
      ),
    ).toBe("bad-image");
  });
});

describe("Anthropic 400s", () => {
  const anthropic400 = (type: string, message: string) =>
    new APICallError({
      message,
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({ type: "error", error: { type, message } }),
    });

  it.each([
    "output_config.effort: unsupported value for this model",
    "output_config.format.schema: maxItems is not supported",
    "model: claude-old is not available",
  ])("a rejected request moves to the next model: %s", (message) => {
    expect(classifyOcrError(anthropic400("invalid_request_error", message))).toBe("not-configured");
  });

  it.each([
    "messages.0.content.0.image.source.base64: image exceeds 5 MB maximum",
    "Could not process image",
    "The PDF specified was not valid.",
  ])("a complaint about the file stays bad-image: %s", (message) => {
    expect(classifyOcrError(anthropic400("invalid_request_error", message))).toBe("bad-image");
  });

  it("another error type or an unreadable body keeps the status mapping", () => {
    expect(classifyOcrError(anthropic400("api_error", "x"))).toBe("bad-image");
    const raw = new APICallError({
      message: "x",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: "<html>",
    });
    expect(classifyOcrError(raw)).toBe("bad-image");
  });
});

describe("classifyOcrError", () => {
  it.each([
    [429, "rate-limited"],
    [500, "provider-error"],
    [503, "provider-error"],
    [408, "timeout"],
    [400, "bad-image"],
    [413, "unsupported-file"],
    [401, "not-configured"],
    [402, "not-configured"],
    [403, "not-configured"],
    [404, "not-configured"],
  ] as const)("maps HTTP %i to %s", (status, kind) => {
    expect(classifyOcrError(apiError(status))).toBe(kind);
  });

  it("treats a call that never got a status (network) as a provider error", () => {
    expect(classifyOcrError(apiError(undefined))).toBe("provider-error");
    expect(classifyOcrError(new TypeError("fetch failed"))).toBe("provider-error");
  });

  it("classifies a retried call by its last error", () => {
    const retried = new RetryError({
      message: "Failed after 2 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiError(503), apiError(429)],
    });
    expect(classifyOcrError(retried)).toBe("rate-limited");
  });

  it("flags output that failed the schema as invalid output", () => {
    const validation = new TypeValidationError({ value: {}, cause: new Error("total missing") });
    expect(classifyOcrError(validation)).toBe("invalid-output");
    const noObject = new NoObjectGeneratedError({
      message: "No object generated",
      text: "{}",
      response: undefined as never,
      usage: undefined as never,
      finishReason: "stop",
    });
    expect(classifyOcrError(noObject)).toBe("invalid-output");
  });

  it("treats timeouts and deadline aborts as timeouts", () => {
    expect(classifyOcrError(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
    expect(classifyOcrError(new DOMException("aborted", "AbortError"))).toBe("timeout");
  });

  it("treats a missing key as not configured", () => {
    const missing = new LoadAPIKeyError({ message: "Google API key is missing" });
    expect(classifyOcrError(missing)).toBe("not-configured");
  });

  it("classifies the fixture's simulated failure as a provider error, so fallback can be tested", async () => {
    const failure = await extractReceipt({
      model: "fixture",
      file: { data: new TextEncoder().encode(FIXTURE_FAIL_MARKER), mediaType: "image/jpeg" },
    }).catch((error: unknown) => error);
    expect(classifyOcrError(failure)).toBe("provider-error");
  });
});

describe("retryAfterMs", () => {
  const limited = (headers: Record<string, string>) =>
    new APICallError({
      message: "429",
      url: "https://provider.test",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: headers,
    });

  it("reads seconds or an HTTP date, through the SDK's wrappers", () => {
    const wrapped = new OcrCallError("rate-limited", null, limited({ "Retry-After": "7" }));
    expect(retryAfterMs(wrapped)).toBe(7000);
    const now = Date.parse("2026-11-06T10:00:00Z");
    const dated = limited({ "retry-after": "Fri, 06 Nov 2026 10:00:30 GMT" });
    expect(
      retryAfterMs(
        new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [dated] }),
        now,
      ),
    ).toBe(30_000);
  });

  it("reads Gemini's RetryInfo from the 429 body when there is no header", () => {
    const body = (retryDelay: unknown) =>
      new APICallError({
        message: "429",
        url: "https://provider.test",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {},
        responseBody: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            details: [
              { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [] },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
            ],
          },
        }),
      });
    expect(retryAfterMs(body("17s"))).toBe(17_000);
    expect(retryAfterMs(body("1.5s"))).toBe(1_500);
    expect(retryAfterMs(body("soon"))).toBeUndefined();
    // A header still wins over the body.
    const both = body("17s");
    Object.assign(both, { responseHeaders: { "retry-after": "3" } });
    expect(retryAfterMs(both)).toBe(3_000);
  });

  it("is undefined when the provider gave no usable hint", () => {
    expect(retryAfterMs(limited({}))).toBeUndefined();
    expect(retryAfterMs(limited({ "retry-after": "soon" }))).toBeUndefined();
    expect(retryAfterMs(new Error("x"))).toBeUndefined();
    const notJson = new APICallError({
      message: "429",
      url: "https://provider.test",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: "<html>busy</html>",
    });
    expect(retryAfterMs(notJson)).toBeUndefined();
  });
});
