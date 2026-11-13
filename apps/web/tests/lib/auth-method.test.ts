import { describe, expect, it } from "vitest";
import { authMethodFor } from "@/lib/auth-method";
import { isImpersonationBlocked, stepUpActionFor } from "@/lib/step-up-paths";

describe("authMethodFor", () => {
  it.each([
    ["/sign-in/email", "password"],
    ["/sign-up/email", "password"],
    ["/two-factor/verify-totp", "mfa"],
    ["/two-factor/verify-backup-code", "mfa"],
    ["/passkey/verify-authentication", "passkey"],
    ["/callback/google", "oauth"],
    ["/verify-email", "email_link"],
    ["/admin/impersonate-user", "impersonation"],
    ["/something-else", "unknown"],
    [undefined, "unknown"],
  ])("%s → %s", (path, expected) => {
    expect(authMethodFor(path, undefined)).toBe(expected);
  });

  it("keeps the value of a rotated session, even a legacy null", () => {
    expect(authMethodFor("/two-factor/verify-totp", "password")).toBe("password");
    expect(authMethodFor("/two-factor/disable", null)).toBeNull();
  });
});

describe("stepUpActionFor", () => {
  it.each([
    ["/delete-user", {}, "account.delete"],
    ["/delete-user", undefined, "account.delete"],
    // A password doesn't skip the check; only the emailed link's token completes a deletion.
    ["/delete-user", { password: "x" }, "account.delete"],
    ["/delete-user", { token: "" }, "account.delete"],
    ["/delete-user", { token: "abc" }, null],
    ["/change-email", { newEmail: "a@example.com" }, "account.change_email"],
    ["/get-session", undefined, null],
    ["/unlink-account", { accountId: "a" }, "account.unlink"],
    // Ending sessions is the victim's way out, so it stays open; renaming a passkey too.
    ["/revoke-other-sessions", {}, null],
    ["/revoke-sessions", {}, null],
    ["/passkey/update-passkey", {}, null],
    ["/change-password", {}, "account.change_password"],
    // Connecting needs the provider to vouch for the same verified address (lib/auth-accounts.ts).
    ["/link-social", { provider: "google" }, null],
    ["/change-email", {}, "account.change_email"],
    ["/two-factor/disable", {}, "two_factor.disable"],
    ["/two-factor/generate-backup-codes", {}, "two_factor.regenerate_backup_codes"],
    ["/passkey/delete-passkey", {}, "passkey.remove"],
    ["/passkey/generate-register-options", undefined, "passkey.add"],
    ["/passkey/verify-authentication", {}, null],
    ["/organization/delete", {}, "workspace.delete"],
    ["/organization/update-member-role", { role: "owner" }, "workspace.transfer_ownership"],
    [
      "/organization/update-member-role",
      { role: ["admin", "owner"] },
      "workspace.transfer_ownership",
    ],
    ["/organization/invite-member", { role: "owner" }, "workspace.transfer_ownership"],
    ["/organization/update-member-role", { role: "admin" }, null],
    ["/admin/ban-user", {}, "admin.ban-user"],
    ["/admin/impersonate-user", {}, "admin.impersonate-user"],
    ["/admin/set-role", {}, "admin.set-role"],
    ["/admin/list-users", {}, null],
    ["/admin/stop-impersonating", {}, null],
    ["/sign-in/email", {}, null],
    ["/two-factor/enable", {}, "two_factor.enable"],
    ["/two-factor/verify-totp", {}, null],
  ])("%s %o → %s", (path, body, expected) => {
    expect(stepUpActionFor(path, body)).toBe(expected);
  });

  it.each([
    ["/two-factor/enable", true],
    ["/passkey/generate-register-options", true],
    // An admin must not connect their own Google/GitHub or mail the customer a link.
    ["/link-social", true],
    ["/send-verification-email", true],
    ["/get-access-token", true],
    ["/refresh-token", true],
    ["/update-user", true],
    ["/revoke-session", true],
    ["/revoke-sessions", true],
    ["/revoke-other-sessions", true],
    ["/organization/create", true],
    ["/organization/update", true],
    ["/organization/delete", true],
    ["/organization/leave", true],
    ["/organization/invite-member", true],
    ["/organization/remove-member", true],
    ["/organization/update-member-role", true],
    ["/organization/accept-invitation", true],
    ["/organization/reject-invitation", true],
    ["/organization/cancel-invitation", true],
    // Reads, and switching to the customer's workspace, stay open.
    ["/organization/set-active", false],
    ["/organization/list", false],
    ["/organization/get-full-organization", false],
    ["/change-password", false],
    ["/get-session", false],
    ["/admin/stop-impersonating", false],
  ])("blocks %s while impersonating: %s", (path, expected) => {
    expect(isImpersonationBlocked(path)).toBe(expected);
  });
});
