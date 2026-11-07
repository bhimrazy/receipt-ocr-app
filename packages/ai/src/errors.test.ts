import {
  APICallError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import { describe, expect, it } from "vitest";
import { classifyOcrError, OcrCallError, retryAfterMs } from "./errors";
import { extractReceipt } from "./extract";
import { FIXTURE_FAIL_MARKER } from "./fixture";

const apiError = (statusCode: number | undefined) =>
  new APICallError({
    message: `status ${statusCode}`,
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode,
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

  it("is undefined when the provider gave no usable hint", () => {
    expect(retryAfterMs(limited({}))).toBeUndefined();
    expect(retryAfterMs(limited({ "retry-after": "soon" }))).toBeUndefined();
    expect(retryAfterMs(new Error("x"))).toBeUndefined();
  });
});
