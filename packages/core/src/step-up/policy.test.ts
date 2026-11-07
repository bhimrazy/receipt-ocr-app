import { describe, expect, it } from "vitest";
import { adminAccess, STEP_UP_TTL_MS, stepUpFresh, stepUpMethods } from "./policy";

const none = { isAdmin: false, twoFactorEnabled: false, passkeys: 0 };

describe("stepUpMethods", () => {
  it.each([
    [{ ...none }, ["email"]],
    [{ ...none, twoFactorEnabled: true }, ["totp", "backup_code"]],
    [{ ...none, passkeys: 2 }, ["passkey"]],
    [{ ...none, passkeys: 1, twoFactorEnabled: true }, ["passkey", "totp", "backup_code"]],
    // Admins never get the email fallback.
    [{ ...none, isAdmin: true }, []],
    [{ ...none, isAdmin: true, twoFactorEnabled: true }, ["totp", "backup_code"]],
  ])("%o → %o", (subject, expected) => {
    expect(stepUpMethods(subject)).toEqual(expected);
  });

  it("lets an admin with no factor enrol with an emailed code, and nothing else", () => {
    const admin = { ...none, isAdmin: true };
    expect(stepUpMethods(admin, "two_factor.enable")).toEqual(["email"]);
    expect(stepUpMethods(admin, "admin.user.ban")).toEqual([]);
    expect(stepUpMethods({ ...admin, twoFactorEnabled: true }, "two_factor.enable")).toEqual([
      "totp",
      "backup_code",
    ]);
  });
});

describe("stepUpFresh", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  /** A session signed in an hour ago, so only an explicit check can make it fresh. */
  const old = ago(60 * 60 * 1000);

  it("is fresh inside 10 minutes with an allowed method", () => {
    const state = { stepUpAt: ago(60_000), stepUpMethod: "totp", createdAt: old };
    expect(stepUpFresh(state, ["totp"], now)).toBe(true);
  });

  it("expires at 10 minutes", () => {
    const state = { stepUpAt: ago(STEP_UP_TTL_MS), stepUpMethod: "totp", createdAt: old };
    expect(stepUpFresh(state, ["totp"], now)).toBe(false);
  });

  it("refuses a method the user may no longer use (email after enrolling a factor)", () => {
    const state = { stepUpAt: ago(1000), stepUpMethod: "email", createdAt: old };
    expect(stepUpFresh(state, ["totp", "backup_code"], now)).toBe(false);
  });

  it("refuses a missing or future-dated check", () => {
    expect(
      stepUpFresh({ stepUpAt: null, stepUpMethod: null, createdAt: old }, ["email"], now),
    ).toBe(false);
    const future = {
      stepUpAt: new Date(now.getTime() + 60_000),
      stepUpMethod: "email",
      createdAt: old,
    };
    expect(stepUpFresh(future, ["email"], now)).toBe(false);
  });

  describe("a recent sign-in", () => {
    const signedIn = (ms: number) => ({ stepUpAt: null, stepUpMethod: null, createdAt: ago(ms) });

    it.each(["account.delete", "account.change_password"])(
      "confirms %s for 10 minutes for a user with no factor",
      (action) => {
        expect(stepUpFresh(signedIn(60_000), ["email"], now, action)).toBe(true);
        expect(stepUpFresh(signedIn(STEP_UP_TTL_MS - 1), ["email"], now, action)).toBe(true);
        expect(stepUpFresh(signedIn(STEP_UP_TTL_MS), ["email"], now, action)).toBe(false);
        expect(stepUpFresh(signedIn(24 * 60 * 60 * 1000), ["email"], now, action)).toBe(false);
      },
    );

    it.each([
      // An unverified account's email change is approved by the new address alone.
      "account.change_email",
      "account.unlink",
      "two_factor.enable",
      "passkey.add",
      "workspace.delete",
      "admin.ban-user",
      undefined,
    ])("never confirms %s, which needs the emailed code", (action) => {
      expect(stepUpFresh(signedIn(1000), ["email"], now, action)).toBe(false);
    });

    it("never counts for a user with a factor, or an admin who must enrol", () => {
      expect(stepUpFresh(signedIn(1000), ["totp", "backup_code"], now, "account.delete")).toBe(
        false,
      );
      expect(stepUpFresh(signedIn(1000), ["passkey"], now, "account.delete")).toBe(false);
      expect(stepUpFresh(signedIn(1000), [], now, "account.delete")).toBe(false);
    });

    it("refuses a future-dated session", () => {
      expect(stepUpFresh(signedIn(-60_000), ["email"], now, "account.delete")).toBe(false);
    });
  });
});

describe("adminAccess", () => {
  const admin = { ...none, isAdmin: true };
  const enrolled = { ...admin, twoFactorEnabled: true };

  it("lets everyone through when enforcement is off", () => {
    expect(
      adminAccess({ enforce: false, subject: admin, authMethod: null, stepUpMethod: null }),
    ).toBe("ok");
  });

  it("sends an admin without a factor to enrol", () => {
    expect(
      adminAccess({ enforce: true, subject: admin, authMethod: "mfa", stepUpMethod: "totp" }),
    ).toBe("enrol");
  });

  it.each([
    ["password", null, "verify"],
    ["oauth", null, "verify"],
    [null, null, "verify"],
    ["oauth", "email", "verify"],
    ["mfa", null, "ok"],
    ["passkey", null, "ok"],
    ["oauth", "totp", "ok"],
    ["password", "backup_code", "ok"],
  ] as const)("authMethod %s, step-up %s → %s", (authMethod, stepUpMethod, expected) => {
    expect(adminAccess({ enforce: true, subject: enrolled, authMethod, stepUpMethod })).toBe(
      expected,
    );
  });

  it("counts a passkey as enrolment", () => {
    expect(
      adminAccess({
        enforce: true,
        subject: { ...admin, passkeys: 1 },
        authMethod: "passkey",
        stepUpMethod: null,
      }),
    ).toBe("ok");
  });
});
