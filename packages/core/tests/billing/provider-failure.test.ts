import { describe, expect, it } from "vitest";
import { BillingProviderError } from "../../src/errors";
import { errorFields } from "../../src/telemetry/redact";
import { PaddleApiError } from "../../src/billing/paddle";
import { providerErrorCode, providerFailure, providerFailureKind } from "../../src/billing/service";

describe("provider failure kind", () => {
  it("names the Paddle status, an unreadable body, or a network failure", () => {
    expect(providerFailureKind(new PaddleApiError(401))).toBe("http-401");
    expect(providerFailureKind(new PaddleApiError(200, "body"))).toBe("bad-response");
    expect(providerFailureKind(new TypeError("fetch failed"))).toBe("network");
  });

  it("reaches the log through errorFields, without the message", () => {
    const error = new BillingProviderError({
      message: "Paddle checkout request failed",
      kind: providerFailureKind(new PaddleApiError(403)),
      cause: new PaddleApiError(403),
    });
    const fields = errorFields(error);
    expect(fields).toMatchObject({ type: "BillingProviderError", kind: "http-403" });
    expect(JSON.stringify(fields)).not.toContain("checkout request failed");
  });

  it("names the provider's error code, and only when it has one", () => {
    expect(
      providerErrorCode(new BillingProviderError({ message: "m", providerCode: "invalid_field" })),
    ).toBe("invalid_field");
    expect(providerErrorCode(new BillingProviderError({ message: "m" }))).toBeUndefined();
    expect(providerErrorCode(new PaddleApiError(400, "status", "invalid_field"))).toBeUndefined();
  });

  it("carries Paddle's code from the call's error to the log fields", () => {
    const error = providerFailure(
      "Paddle checkout request failed",
      new PaddleApiError(400, "status", "transaction_default_checkout_url_not_set"),
    );
    expect(error).toMatchObject({
      kind: "http-400",
      providerCode: "transaction_default_checkout_url_not_set",
    });
    expect(providerErrorCode(error)).toBe("transaction_default_checkout_url_not_set");
    expect(providerFailure("m", new PaddleApiError(500)).providerCode).toBeUndefined();
    expect(providerFailure("m", new TypeError("fetch failed")).providerCode).toBeUndefined();
  });
});
