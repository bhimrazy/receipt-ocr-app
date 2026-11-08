import type { StepUpAction } from "@receipt-ocr/core";
import { hasDeleteToken } from "./account-deletion";

/** Admin plugin endpoints that only read, or end an impersonation: no step-up. */
const ADMIN_READS = new Set([
  "/admin/list-users",
  "/admin/list-user-sessions",
  "/admin/get-user",
  "/admin/has-permission",
  "/admin/stop-impersonating",
]);

const FIXED: Record<string, StepUpAction> = {
  "/delete-user": "account.delete",
  "/change-email": "account.change_email",
  "/change-password": "account.change_password",
  // Better Auth's freshAge was its only guard, and freshAge is off (lib/auth.ts).
  "/unlink-account": "account.unlink",
  "/two-factor/enable": "two_factor.enable",
  "/two-factor/disable": "two_factor.disable",
  "/two-factor/generate-backup-codes": "two_factor.regenerate_backup_codes",
  "/passkey/delete-passkey": "passkey.remove",
  // Adding a passkey is checked, or a stolen session could add the thief's own.
  "/passkey/generate-register-options": "passkey.add",
  "/passkey/verify-registration": "passkey.add",
  "/organization/delete": "workspace.delete",
};

const grantsOwner = (body: unknown) => {
  const role = (body as { role?: unknown } | null)?.role;
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((value) => typeof value === "string" && value.split(",").includes("owner"));
};

/**
 * The step-up action a Better Auth request needs, or null. Checked in a
 * global `hooks.before`, so calling the endpoint directly can't skip the
 * check the UI asks for.
 */
export function stepUpActionFor(path: string, body: unknown): StepUpAction | null {
  // Requesting deletion only emails a link; the link's token completes it from any session.
  if (path === "/delete-user" && hasDeleteToken(body)) return null;
  const fixed = FIXED[path];
  if (fixed) return fixed;
  if (path === "/organization/update-member-role" || path === "/organization/invite-member") {
    return grantsOwner(body) ? "workspace.transfer_ownership" : null;
  }
  if (path.startsWith("/admin/") && !ADMIN_READS.has(path)) {
    return `admin.${path.slice("/admin/".length)}`;
  }
  return null;
}

/** Account writes an admin could otherwise make as the customer: connect their own Google or GitHub, or mail a link. */
const ACCOUNT_WRITES = new Set(["/link-social", "/send-verification-email"]);

/**
 * Endpoints refused for an impersonation session: factor changes (or an admin could enrol their
 * own authenticator on the customer's account) and ACCOUNT_WRITES. Sign-in verification and a
 * signed-out resend have no session, so they are never blocked.
 */
export const isImpersonationBlocked = (path: string) =>
  path.startsWith("/two-factor/") || path.startsWith("/passkey/") || ACCOUNT_WRITES.has(path);
