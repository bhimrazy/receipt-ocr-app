import { describe, expect, it } from "vitest";
import { BillingProviderError } from "../errors";
import { errorFields } from "../telemetry/redact";
import { PaddleApiError } from "./paddle";
import { providerFailureKind } from "./service";

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
});
