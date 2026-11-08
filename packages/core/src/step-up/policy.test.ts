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

  it("is fresh inside 10 minutes with an allowed method", () => {
    expect(stepUpFresh({ stepUpAt: ago(60_000), stepUpMethod: "totp" }, ["totp"], now)).toBe(true);
    expect(
      stepUpFresh({ stepUpAt: ago(STEP_UP_TTL_MS - 1), stepUpMethod: "email" }, ["email"], now),
    ).toBe(true);
  });

  it("expires at 10 minutes", () => {
    const state = { stepUpAt: ago(STEP_UP_TTL_MS), stepUpMethod: "totp" };
    expect(stepUpFresh(state, ["totp"], now)).toBe(false);
  });

  it("refuses a method the user may no longer use (email after enrolling a factor)", () => {
    const state = { stepUpAt: ago(1000), stepUpMethod: "email" };
    expect(stepUpFresh(state, ["totp", "backup_code"], now)).toBe(false);
  });

  it("refuses a session with no check, however recent its sign-in, or a future-dated check", () => {
    expect(stepUpFresh({ stepUpAt: null, stepUpMethod: null }, ["email"], now)).toBe(false);
    const future = { stepUpAt: new Date(now.getTime() + 60_000), stepUpMethod: "email" };
    expect(stepUpFresh(future, ["email"], now)).toBe(false);
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
