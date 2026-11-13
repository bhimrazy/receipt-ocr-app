import { describe, expect, it } from "vitest";
import { authRateLimitRules } from "@/lib/auth-rate-limit";

describe("auth rate limits", () => {
  it("allows 3 sign-ups and 5 sign-ins a minute per IP", () => {
    expect(authRateLimitRules["/sign-up/email"]).toEqual({ window: 60, max: 3 });
    expect(authRateLimitRules["/sign-in/email"]).toEqual({ window: 60, max: 5 });
  });

  it("limits passkey sign-in attempts per IP", () => {
    expect(authRateLimitRules["/passkey/verify-authentication"]).toEqual({ window: 60, max: 10 });
  });

  it("allows 10 account-deletion and 10 email-change calls an hour per IP", () => {
    expect(authRateLimitRules["/delete-user"]).toEqual({ window: 3600, max: 10 });
    expect(authRateLimitRules["/change-email"]).toEqual({ window: 3600, max: 10 });
  });
});
