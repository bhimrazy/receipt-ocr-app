/**
 * Mirrors the server rule: workspace owners and admins may change any receipt, members only the
 * ones they uploaded. Used to hide controls; the API enforces it either way.
 */
export function canEditReceipt(
  scope: { userId: string; role: string },
  receipt: { userId: string },
): boolean {
  // Better Auth allows several comma-separated roles on one membership.
  const roles = scope.role.split(",").map((role) => role.trim());
  if (roles.includes("owner") || roles.includes("admin")) return true;
  return receipt.userId === scope.userId;
}
