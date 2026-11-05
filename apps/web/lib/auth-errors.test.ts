import { describe, expect, it } from "vitest";
import { authErrorMessage, socialErrorMessage, SUSPENDED_MESSAGE } from "./auth-errors";

describe("sign-in error messages", () => {
  it("shows the same suspended message for email and social sign-in", () => {
    expect(authErrorMessage({ code: "BANNED_USER", message: "You have been banned" })).toBe(
      SUSPENDED_MESSAGE,
    );
    expect(socialErrorMessage("BANNED_USER")).toBe(SUSPENDED_MESSAGE);
  });

  it("keeps Better Auth's message for other email errors", () => {
    expect(
      authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
    ).toBe("Invalid email or password");
    expect(authErrorMessage({})).toMatch(/try again/i);
  });

  it("shows nothing without an error and a generic message for other social errors", () => {
    expect(socialErrorMessage(undefined)).toBeNull();
    expect(socialErrorMessage("state_mismatch")).toMatch(/didn't work/);
  });
});
