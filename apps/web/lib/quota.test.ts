import { describe, expect, it } from "vitest";
import { quotaMessage, type QuotaVerdict } from "./quota";

describe("quotaMessage", () => {
  const base: QuotaVerdict = { allowed: false, limit: 10, used: 10 };

  it("distinguishes the burst window from the daily one", () => {
    expect(quotaMessage({ ...base, window: "minute" })).toContain("per minute");
    expect(quotaMessage({ ...base, window: "day", limit: 50 })).toContain("daily limit");
  });

  it("names the actual limit so the message is actionable", () => {
    expect(quotaMessage({ ...base, window: "minute", limit: 10 })).toContain("10");
    expect(quotaMessage({ ...base, window: "day", limit: 50 })).toContain("50");
  });
});
