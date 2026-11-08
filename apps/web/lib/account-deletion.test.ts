import { describe, expect, it } from "vitest";
import {
  deleteConfirmUrl,
  hasDeleteToken,
  isDeleteToken,
  soleOwnerMessage,
} from "./account-deletion";

describe("hasDeleteToken", () => {
  it("is true only for a non-empty token", () => {
    expect(hasDeleteToken({ token: "abc" })).toBe(true);
    expect(hasDeleteToken({ token: "" })).toBe(false);
    expect(hasDeleteToken({ password: "x" })).toBe(false);
    expect(hasDeleteToken(undefined)).toBe(false);
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
