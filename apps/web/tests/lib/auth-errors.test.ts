import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  callbackErrorMessage,
  passkeyErrorMessage,
  SUSPENDED_MESSAGE,
  twoFactorRestart,
} from "@/lib/auth-errors";

describe("authErrorMessage", () => {
  it("replaces Better Auth's developer wording by code", () => {
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(
      "An account with this email already exists. Sign in instead.",
    );
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toMatch(
      /don't match an account/,
    );
  });

  it("explains captcha failures by code", () => {
    expect(authErrorMessage({ code: "MISSING_RESPONSE", status: 400 })).toMatch(/security check/);
    expect(authErrorMessage({ code: "VERIFICATION_FAILED", status: 403 })).toMatch(
      /security check failed/,
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

describe("two-step sign-in errors", () => {
  it("maps the plugin's codes, and the lockout before the generic 429", () => {
    expect(authErrorMessage({ code: "INVALID_CODE", status: 401 })).toMatch(/newest code/);
    expect(authErrorMessage({ code: "INVALID_BACKUP_CODE" })).toMatch(/already used/);
    expect(authErrorMessage({ code: "ACCOUNT_TEMPORARILY_LOCKED", status: 429 })).toMatch(
      /15 minutes/,
    );
    expect(authErrorMessage({ code: "STEP_UP_REQUIRED", status: 403 })).toMatch(/Confirm it's you/);
  });

  it("asks for a new password step only when the challenge is gone", () => {
    expect(twoFactorRestart({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" })).toBe(true);
    expect(twoFactorRestart({ code: "INVALID_TWO_FACTOR_COOKIE" })).toBe(true);
    expect(twoFactorRestart({ code: "INVALID_CODE" })).toBe(false);
  });
});

describe("passkeyErrorMessage", () => {
  it("treats a dismissed or timed-out prompt as a cancel", () => {
    for (const code of [
      "AUTH_CANCELLED",
      "ERROR_CEREMONY_ABORTED",
      "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    ]) {
      expect(passkeyErrorMessage({ code })).toBe("Cancelled or timed out. Try again.");
    }
  });

  it("explains a duplicate, an unknown passkey and a stale session", () => {
    expect(passkeyErrorMessage({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toMatch(
      /already on your account/,
    );
    expect(passkeyErrorMessage({ code: "PASSKEY_NOT_FOUND" })).toMatch(/didn't work here/);
    expect(passkeyErrorMessage({ code: "SESSION_NOT_FRESH" })).toMatch(/sign out and in again/);
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

describe("suspended accounts", () => {
  it("shows the same suspended message for email and social sign-in", () => {
    expect(authErrorMessage({ code: "BANNED_USER", message: "You have been banned" })).toBe(
      SUSPENDED_MESSAGE,
    );
    expect(callbackErrorMessage("BANNED_USER")).toBe(SUSPENDED_MESSAGE);
  });
});
