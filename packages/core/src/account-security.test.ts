import { describe, expect, it } from "vitest";
import {
  canRemoveAccount,
  canRemovePasskey,
  signInMethodCount,
  type SignInMethods,
} from "./account-security";

const at = new Date("2026-11-01T00:00:00Z");
const password = { id: "a-pw", providerId: "credential", createdAt: at, hasPassword: true };
const google = { id: "a-g", providerId: "google", createdAt: at, hasPassword: false };
const github = { id: "a-gh", providerId: "github", createdAt: at, hasPassword: false };

const methods = (accounts: SignInMethods["accounts"], passkeys = 0): SignInMethods => ({
  email: "a@example.com",
  emailVerified: true,
  twoFactorEnabled: false,
  passkeys,
  accounts,
});

const both = ["google", "github"];

describe("signInMethodCount", () => {
  it("counts a password, configured providers and passkeys", () => {
    expect(signInMethodCount(methods([password, google], 2), both)).toBe(4);
  });

  it("skips a credential row without a password and a provider that isn't configured", () => {
    const noPassword = { ...password, hasPassword: false };
    expect(signInMethodCount(methods([noPassword, github]), ["google"])).toBe(0);
  });
});

describe("canRemoveAccount", () => {
  it("allows disconnecting a provider while a password remains", () => {
    expect(canRemoveAccount(methods([password, google]), google.id, both)).toBe(true);
  });

  it("refuses the last way to sign in", () => {
    expect(canRemoveAccount(methods([google]), google.id, both)).toBe(false);
  });

  it("counts a passkey as a way to sign in", () => {
    expect(canRemoveAccount(methods([google], 1), google.id, both)).toBe(true);
  });

  it("allows one provider when another configured one remains", () => {
    expect(canRemoveAccount(methods([google, github]), google.id, both)).toBe(true);
  });

  it("doesn't count a remaining provider this deployment no longer configures", () => {
    expect(canRemoveAccount(methods([google, github]), google.id, ["google"])).toBe(false);
  });

  it("lets an id the user doesn't own through, for Better Auth to refuse", () => {
    expect(canRemoveAccount(methods([google]), "someone-else", both)).toBe(true);
  });
});

describe("canRemovePasskey", () => {
  it("refuses the last passkey when no account can sign in", () => {
    expect(canRemovePasskey(methods([], 1), both)).toBe(false);
    expect(canRemovePasskey(methods([github], 1), ["google"])).toBe(false);
  });

  it("allows it with another passkey, a password or a configured provider", () => {
    expect(canRemovePasskey(methods([], 2), both)).toBe(true);
    expect(canRemovePasskey(methods([password], 1), both)).toBe(true);
    expect(canRemovePasskey(methods([google], 1), both)).toBe(true);
  });
});
