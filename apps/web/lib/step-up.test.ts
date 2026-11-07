import { describe, expect, it } from "vitest";
import {
  FRESH_AGE_SECONDS,
  deleteConfirmUrl,
  isDeleteToken,
  isSessionFresh,
  needsFreshSession,
  soleOwnerMessage,
} from "./step-up";

describe("needsFreshSession", () => {
  it("covers requesting deletion and changing the email", () => {
    expect(needsFreshSession("/delete-user", {})).toBe(true);
    expect(needsFreshSession("/delete-user", undefined)).toBe(true);
    expect(needsFreshSession("/delete-user", { password: "x" })).toBe(true);
    expect(needsFreshSession("/change-email", { newEmail: "a@example.com" })).toBe(true);
  });

  it("exempts completing a deletion with the emailed token, and everything else", () => {
    expect(needsFreshSession("/delete-user", { token: "abc" })).toBe(false);
    expect(needsFreshSession("/delete-user", { token: "" })).toBe(true);
    expect(needsFreshSession("/change-password", {})).toBe(false);
    expect(needsFreshSession("/get-session", undefined)).toBe(false);
  });
});

describe("isSessionFresh", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  it(`is fresh for ${FRESH_AGE_SECONDS / 60} minutes after sign-in`, () => {
    expect(isSessionFresh(new Date(now - 60_000), now)).toBe(true);
    expect(isSessionFresh(new Date(now - FRESH_AGE_SECONDS * 1000), now)).toBe(false);
    expect(isSessionFresh("2026-11-06T12:00:00Z", now)).toBe(false);
  });
});

describe("deleteConfirmUrl", () => {
  it("keeps Better Auth's origin and carries only the token", () => {
    const url = deleteConfirmUrl(
      "https://app.example/api/auth/delete-user/callback?token=t0k&callbackURL=%2F",
      "t0k",
    );
    expect(url).toBe("https://app.example/app/settings/delete-account?token=t0k");
  });

  it("accepts only Better Auth's token shape", () => {
    expect(isDeleteToken("a".repeat(32))).toBe(true);
    expect(isDeleteToken("A".repeat(32))).toBe(false);
    expect(isDeleteToken(["a".repeat(32)])).toBe(false);
    expect(isDeleteToken(undefined)).toBe(false);
  });
});

describe("soleOwnerMessage", () => {
  it("names one workspace or several in plain words", () => {
    expect(soleOwnerMessage(["Acme"], "request a new link")).toBe(
      "You own Acme, which has other members. Make one of them an owner, then request a new link.",
    );
    expect(soleOwnerMessage(["Acme", "Beta", "Coda"], "try again")).toBe(
      "You own Acme, Beta and Coda, which have other members. Make one of them an owner of each, then try again.",
    );
  });
});
