import { describe, expect, it } from "vitest";
import { authErrorMessage, callbackErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("replaces Better Auth's developer wording by code", () => {
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(
      "An account with this email already exists. Sign in instead.",
    );
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toMatch(
      /don't match an account/,
    );
  });

  it("explains rate limits whatever the code", () => {
    expect(authErrorMessage({ status: 429, message: "Too many requests." })).toBe(
      "Too many attempts. Wait 1 minute and try again.",
    );
  });

  it("falls back to the server message, then to a generic line", () => {
    expect(authErrorMessage({ code: "SOMETHING_NEW", message: "Server said no" })).toBe(
      "Server said no",
    );
    expect(authErrorMessage({})).toBe("Something went wrong. Try again.");
    expect(authErrorMessage(null)).toBe("Something went wrong. Try again.");
  });
});

describe("callbackErrorMessage", () => {
  it("maps verification and OAuth codes in any case", () => {
    expect(callbackErrorMessage("TOKEN_EXPIRED")).toMatch(/confirmation link has expired/);
    expect(callbackErrorMessage("access_denied")).toMatch(/cancelled/);
  });

  it("never echoes an unknown query value", () => {
    expect(callbackErrorMessage("<script>")).not.toContain("<script>");
    expect(callbackErrorMessage(undefined)).toBeUndefined();
  });
});
