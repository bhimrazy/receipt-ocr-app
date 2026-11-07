import { describe, expect, it } from "vitest";
import { authRateLimitRules } from "./auth-rate-limit";

describe("auth rate limits", () => {
  it("allows 3 sign-ups and 5 sign-ins a minute per IP", () => {
    expect(authRateLimitRules["/sign-up/email"]).toEqual({ window: 60, max: 3 });
    expect(authRateLimitRules["/sign-in/email"]).toEqual({ window: 60, max: 5 });
  });
});
