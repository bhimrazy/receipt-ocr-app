import type { StepUpAction } from "@receipt-ocr/core";

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
  "/two-factor/enable": "two_factor.enable",
  "/two-factor/disable": "two_factor.disable",
  "/two-factor/generate-backup-codes": "two_factor.regenerate_backup_codes",
  "/passkey/delete-passkey": "passkey.remove",
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

/**
 * Factor endpoints, refused for an impersonation session: otherwise an admin
 * could enrol their own authenticator on the customer's account. Sign-in
 * verification has no session yet, so it is never blocked.
 */
export const isFactorEndpoint = (path: string) =>
  path.startsWith("/two-factor/") || path.startsWith("/passkey/");
