import { PADDLE_ERROR_CODES } from "@receipt-ocr/core";
import { describe, expect, it } from "vitest";
import { billingSetupHint } from "@/lib/billing-setup-hint";

describe("billingSetupHint", () => {
  it("names the Paddle setting for an account that can't sell yet", () => {
    expect(billingSetupHint("transaction_default_checkout_url_not_set")).toMatch(
      /default payment link.*\/pay/,
    );
    expect(billingSetupHint("checkout_url_domain_not_approved")).toMatch(/Website approval/);
    expect(billingSetupHint("transaction_checkout_url_domain_is_not_approved")).toMatch(
      /Website approval/,
    );
  });

  it("only uses codes the logs keep by name, so no hint is unreachable", () => {
    const hinted = [
      "transaction_default_checkout_url_not_set",
      "checkout_url_domain_not_approved",
      "transaction_checkout_url_domain_is_not_approved",
    ];
    for (const code of hinted) expect(PADDLE_ERROR_CODES).toContain(code);
    expect(billingSetupHint("other")).toBeNull();
  });

  it("is null for other codes, none, and inherited keys", () => {
    for (const code of [undefined, "invalid_field", "not_found", "constructor", "toString"]) {
      expect(billingSetupHint(code), String(code)).toBeNull();
    }
  });
});
